import { AfterViewInit, Directive, ElementRef, HostListener, Input, inject } from '@angular/core';

/**
 * WAI-ARIA APG roving-tabindex for a COMPOSITE widget (a `role="tablist"` or
 * `role="toolbar"`): exactly ONE child control is in the Tab sequence
 * (`tabindex="0"`); the rest are `tabindex="-1"`, and Arrow / Home / End move the
 * roving focus between them. This is the keyboard contract the APG requires for
 * tablists and toolbars — without it the only way to reach a non-active tab is the
 * mouse (WCAG 2.1.1) or, at best, every tab is in the Tab order (which the APG
 * forbids for these patterns).
 *
 * <p>Applied to the composite CONTAINER. The managed items are its focusable
 * descendants (`<button>` / `[role=tab]` / `[tabindex]`) that are not disabled.
 * Orientation defaults to horizontal (Left/Right); pass `vertical` for Up/Down.
 * The directive is presentation-only — it never changes selection; a tab's
 * `(click)`/activation handler (or the native button) still does that, and on a
 * tablist that follows the APG "selection follows focus" affordance because the
 * host wires Enter/Space/click to select. Focus order matches DOM order, so the
 * container must lay items out in reading order (no positive tabindex needed).
 */
@Directive({
  selector: '[snapRovingFocus]',
  standalone: true,
})
export class RovingFocusDirective implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** 'horizontal' (Left/Right, the default) or 'vertical' (Up/Down). */
  @Input('snapRovingFocus') orientation: 'horizontal' | 'vertical' | '' = 'horizontal';

  /** The roving items in DOM order: enabled, focusable composite children. */
  private items(): HTMLElement[] {
    const all = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button, [role="tab"], [tabindex]',
      ),
    );
    return all.filter(
      (el) =>
        !el.hasAttribute('disabled') &&
        el.getAttribute('aria-disabled') !== 'true' &&
        el.offsetParent !== null,
    );
  }

  /** Initialise the roving tabindex so exactly one item is tabbable. */
  ngAfterViewInit(): void {
    queueMicrotask(() => this.syncTabindex());
  }

  /** Re-derive the single tabbable item: the focused/selected one, else the first. */
  private syncTabindex(): void {
    const items = this.items();
    if (items.length === 0) return;
    const active = this.host.nativeElement.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    const selected = items.find((el) => el.getAttribute('aria-selected') === 'true');
    const tabbable = (active && items.includes(active) ? active : selected) ?? items[0];
    for (const el of items) {
      el.tabIndex = el === tabbable ? 0 : -1;
    }
  }

  private isPrev(key: string): boolean {
    return this.orientation === 'vertical' ? key === 'ArrowUp' : key === 'ArrowLeft';
  }
  private isNext(key: string): boolean {
    return this.orientation === 'vertical' ? key === 'ArrowDown' : key === 'ArrowRight';
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      return;
    }
    const items = this.items();
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement | null;
    const idx = current ? items.indexOf(current) : -1;
    // If focus is not yet on a managed item, an Arrow lands on the first/last.
    let nextIdx: number;
    if (key === 'Home') {
      nextIdx = 0;
    } else if (key === 'End') {
      nextIdx = items.length - 1;
    } else if (this.isPrev(key)) {
      nextIdx = idx <= 0 ? items.length - 1 : idx - 1;
    } else if (this.isNext(key)) {
      nextIdx = idx < 0 ? 0 : (idx + 1) % items.length;
    } else {
      return;
    }

    event.preventDefault();
    const target = items[nextIdx];
    for (const el of items) {
      el.tabIndex = el === target ? 0 : -1;
    }
    target.focus();
  }

  /** Keep the roving tabindex correct after a focus enters from outside (Tab in). */
  @HostListener('focusin')
  onFocusin(): void {
    this.syncTabindex();
  }
}
