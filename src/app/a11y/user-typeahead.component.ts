import {
  Component,
  DestroyRef,
  ElementRef,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService, DirectoryUser } from '../bff.service';

/**
 * The user picker every admin console shares — a WAI-ARIA APG **combobox with a listbox
 * popup**, replacing the bare free-text boxes that previously required an admin to already
 * know a user's exact Casdoor username.
 *
 * <h3>Why a hand-rolled combobox</h3>
 * This repo has NO component library (see package.json — Angular core/forms/router only,
 * no Material, no CDK), and adding one for a single control would be a large new dependency
 * for a small widget. So this implements the APG pattern directly, in the same spirit as the
 * sibling {@link RovingFocusDirective}: the ARIA contract written out explicitly rather than
 * inherited from a framework.
 *
 * <h3>The ARIA contract (APG "combobox with listbox popup", manual selection)</h3>
 * <ul>
 *   <li>The INPUT carries {@code role=combobox}, {@code aria-expanded},
 *       {@code aria-controls} → the listbox id, and {@code aria-activedescendant} → the id
 *       of the visually-highlighted option. DOM focus never leaves the input, so the user
 *       keeps typing while arrowing — which is why activedescendant is the right mechanism
 *       here rather than moving focus into the list.</li>
 *   <li>The popup is a {@code role=listbox} of {@code role=option} elements, each with
 *       {@code aria-selected} on the active one.</li>
 *   <li>Keys: ArrowDown/ArrowUp move the active option (and open a closed popup),
 *       Enter commits the active option, Escape closes the popup WITHOUT changing the
 *       value, Tab commits nothing and lets focus leave.</li>
 *   <li>A {@code role=status} live region announces the result count / the "keep typing"
 *       and "no matches" states, so a screen-reader user learns the list changed without
 *       having to arrow into it.</li>
 * </ul>
 *
 * <h3>Free text is always still allowed</h3>
 * The bound value is whatever is in the input. Picking a suggestion just fills it in. This
 * is deliberate: the directory is built from the ALLOWLIST, so a legitimately targetable
 * identity that is not an invite row (or one the search is briefly unable to reach) must
 * still be typeable. A picker that refused unknown values would turn a directory outage
 * into an outage of every admin action.
 *
 * <h3>Scope is the server's job</h3>
 * Suggestions come from {@code GET /bff/admin/users/search}, which scopes results to the
 * caller's own brand from their validated token and caps the row count server-side. This
 * component never sends a domain and never filters a larger list down — a client-side
 * filter would be an enumeration hole, not a scope.
 */
@Component({
  selector: 'hug-user-typeahead',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-typeahead.component.html',
  styleUrl: './user-typeahead.component.scss',
})
export class UserTypeaheadComponent {
  private readonly bff = inject(BffService);
  private readonly destroyRef = inject(DestroyRef);

  /** Debounce window. Long enough that ordinary typing issues one request per pause,
   *  short enough that the list feels attached to the keyboard. */
  static readonly DEBOUNCE_MS = 250;

  /** Minimum query length before the BFF is called at all — below this the control shows
   *  its "keep typing" state. Two characters keeps a single stray keystroke from firing a
   *  request whose result would be uselessly broad. */
  static readonly MIN_QUERY = 2;

  /** Rows requested per search. The BFF clamps this to its own ceiling regardless. */
  static readonly PAGE_SIZE = 8;

  /** DOM id of the input — the caller's `<label for>` target. Must be unique per instance. */
  @Input({ required: true }) inputId!: string;
  /** `data-testid` on the input, so existing per-form test hooks survive the swap. */
  @Input() testId = '';
  /** `name` attribute — forms in this repo are ngForm-based and rely on it. */
  @Input() name = 'user';
  /** Placeholder shown in the empty input. */
  @Input() placeholder = '';
  /** Space-separated ids appended to the control's own describedby chain (field help,
   *  validation errors) so the caller's helptext is still announced. */
  @Input() describedBy = '';
  /** Mirrors the caller's validation state onto the input. */
  @Input() invalid = false;
  /**
   * Optional `maxlength` on the input. Only set it where the TARGET endpoint has a length
   * bound of its own (the image-gen worklist's `targetUser` is capped at 400 by the BFF's
   * `BatchImageSpec`), so the box stops accepting characters the submit would reject
   * anyway. Left null the attribute is omitted entirely — most pickers feed endpoints with
   * no such bound, and inventing one here would silently truncate a legitimate identity.
   */
  @Input() maxLength: number | null = null;
  /**
   * Which spelling of the picked identity to write into the input. The admin surfaces do
   * NOT agree on one — and guessing wrong would fill the box with a value the endpoint
   * cannot resolve, which is worse than the free-text box this replaces:
   *
   * - `username`  — the bare Casdoor username. What `/bff/admin/roles/{roleName}/{user}`,
   *   `/bff/admin/access-roles/{role}/{user}` and `/bff/admin/domain-lock/{role}/{user}`
   *   key on.
   * - `qualified` — `provider:handle`. What `AccountStore#namespacesFor` matches on
   *   (`Account.id()`), and the form the desktop-sudo subject field documents in its own
   *   placeholder.
   */
  @Input() commit: 'username' | 'qualified' = 'username';
  /** The current value (two-way bound via `value` / `valueChange`). */
  @Input() value = '';
  /** Emitted on every input keystroke AND on commit — the `[(value)]` banana-in-a-box half. */
  @Output() valueChange = new EventEmitter<string>();

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('input');

  /** The current suggestion list. Empty while closed, below MIN_QUERY, or on no matches. */
  readonly options = signal<DirectoryUser[]>([]);
  /** Whether the listbox popup is rendered. */
  readonly open = signal(false);
  /** Index of the active (aria-activedescendant) option, or -1 for none. */
  readonly activeIndex = signal(-1);
  /** True while a search request is in flight — drives the "searching" status text. */
  readonly searching = signal(false);
  /** True once a search has run for the current query and returned nothing. */
  readonly noMatches = signal(false);

  /** Pending debounce timer, cleared on every keystroke and on destroy. */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight request controller, aborted when a newer keystroke supersedes it. Without
   *  this, a slow early request could land after a fast later one and repopulate the list
   *  with results for a query the user has already moved past. */
  private inflight: AbortController | null = null;

  constructor() {
    // A timer or fetch that outlives the component would call into a destroyed view.
    this.destroyRef.onDestroy(() => this.cancelPending());
  }

  /** The listbox element id, derived from the input id so both are unique per instance. */
  get listboxId(): string {
    return `${this.inputId}-listbox`;
  }

  /** The live-region element id — referenced by the input's describedby chain. */
  get statusId(): string {
    return `${this.inputId}-status`;
  }

  /** The id of option `i` — the value `aria-activedescendant` points at. */
  optionId(i: number): string {
    return `${this.inputId}-opt-${i}`;
  }

  /** `aria-activedescendant`: the active option's id, or null when nothing is active. */
  get activeDescendant(): string | null {
    const i = this.activeIndex();
    return this.open() && i >= 0 && i < this.options().length ? this.optionId(i) : null;
  }

  /**
   * The input's describedby chain: the caller's ids, plus our live region ONLY while it
   * actually says something. Referencing an empty node would make a screen reader read the
   * control's description as trailing silence — and the region still announces its own
   * changes via `aria-live` regardless of whether it is described-by.
   */
  get describedByChain(): string {
    return [this.describedBy, this.statusText ? this.statusId : '']
      .filter(Boolean).join(' ');
  }

  /**
   * The `role=status` text. Every state the user could be in is named, because an
   * empty list is ambiguous otherwise — "did it find nothing, or is it still thinking,
   * or have I not typed enough yet?".
   */
  get statusText(): string {
    const q = this.value.trim();
    if (!q) return '';
    if (q.length < UserTypeaheadComponent.MIN_QUERY) {
      return `Keep typing — ${UserTypeaheadComponent.MIN_QUERY} characters needed to search.`;
    }
    if (this.searching()) return 'Searching your domain…';
    if (this.noMatches()) {
      return 'No matching users in your domain. You can still type a username directly.';
    }
    const n = this.options().length;
    if (!n) return '';
    return `${n} matching user${n === 1 ? '' : 's'}. Use the up and down arrow keys to review, Enter to choose.`;
  }

  /** Keystroke handler: publish the raw value immediately, then debounce the search. */
  onInput(raw: string): void {
    this.value = raw;
    this.valueChange.emit(raw);
    this.noMatches.set(false);
    this.activeIndex.set(-1);
    this.scheduleSearch(raw);
  }

  /**
   * Keyboard contract. Returns nothing; each branch calls `preventDefault` only where the
   * key would otherwise do something unwanted (ArrowUp/Down move the text caret; Enter
   * submits the surrounding form).
   */
  onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.move(-1);
        break;
      case 'Enter': {
        const i = this.activeIndex();
        // Only swallow Enter when it is actually choosing something. With the popup shut
        // (or nothing highlighted) Enter must still submit the form the picker sits in.
        if (this.open() && i >= 0 && i < this.options().length) {
          e.preventDefault();
          this.choose(this.options()[i]);
        }
        break;
      }
      case 'Escape':
        // Close only — Escape must never clear what the admin typed.
        if (this.open()) {
          e.preventDefault();
          this.close();
        }
        break;
      default:
        break;
    }
  }

  /** Commit a suggestion in the spelling this field's endpoint resolves (see
   *  {@link commit}), close the popup, and hand focus back to the input. */
  choose(u: DirectoryUser): void {
    const picked = this.commitValue(u);
    this.value = picked;
    this.valueChange.emit(picked);
    // Drop the suggestion list, not just the popup. The focus() below fires onFocus, which
    // re-opens the popup whenever suggestions are still held — so closing alone would make
    // the list spring straight back open over the value the user just chose.
    this.options.set([]);
    this.close();
    this.inputEl()?.nativeElement.focus();
  }

  /** The identity spelling {@link commit} selects for this field. */
  private commitValue(u: DirectoryUser): string {
    return this.commit === 'qualified' ? `${u.provider}:${u.handle}` : u.username;
  }

  /** Close on blur, but only once any click on an option has had a chance to land. */
  onBlur(): void {
    // A mousedown on an option blurs the input BEFORE the click fires; closing
    // synchronously would unmount the option and swallow the selection.
    setTimeout(() => this.close(), 150);
  }

  /** Re-open the popup when a previously-searched input regains focus. */
  onFocus(): void {
    if (this.options().length) this.open.set(true);
  }

  /** A row's secondary line: the invite handle, plus the provider when it adds information. */
  subtitle(u: DirectoryUser): string {
    return u.handle === u.username ? u.provider : `${u.handle} · ${u.provider}`;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Move the active option by `delta`, wrapping, opening a closed popup first. */
  private move(delta: number): void {
    const n = this.options().length;
    if (!n) return;
    if (!this.open()) {
      this.open.set(true);
      // Opening with ArrowDown lands on the first option; with ArrowUp, the last.
      this.activeIndex.set(delta > 0 ? 0 : n - 1);
      return;
    }
    const next = (this.activeIndex() + delta + n) % n;
    this.activeIndex.set(next);
  }

  /** Debounce a search for `raw`, cancelling whatever was pending. */
  private scheduleSearch(raw: string): void {
    this.cancelPending();
    const q = raw.trim();
    if (q.length < UserTypeaheadComponent.MIN_QUERY) {
      this.options.set([]);
      this.open.set(false);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.timer = setTimeout(() => this.runSearch(q), UserTypeaheadComponent.DEBOUNCE_MS);
  }

  /** Issue the (abortable) search and fold the result into the popup state. */
  private async runSearch(q: string): Promise<void> {
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const rows = await this.bff.searchUsers(q, UserTypeaheadComponent.PAGE_SIZE, controller.signal);
      // A superseded request must not touch state — cancelPending aborted it, but the
      // await may already have resolved by the time the abort lands.
      if (controller.signal.aborted) return;
      this.options.set(rows);
      this.noMatches.set(rows.length === 0);
      this.open.set(rows.length > 0);
      this.activeIndex.set(-1);
    } catch {
      // searchUsers already degrades a failed lookup to []; this catches an abort
      // rejection. Either way the control keeps its free-text fallback.
      if (!controller.signal.aborted) {
        this.options.set([]);
        this.open.set(false);
      }
    } finally {
      if (!controller.signal.aborted) this.searching.set(false);
      if (this.inflight === controller) this.inflight = null;
    }
  }

  /** Close the popup and drop the active option (the typed value is untouched). */
  private close(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  /** Cancel the debounce timer and abort any in-flight request. */
  private cancelPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
  }
}
