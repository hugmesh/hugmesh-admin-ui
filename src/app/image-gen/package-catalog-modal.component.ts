import { Component, EventEmitter, Output, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FocusTrapDirective } from '../a11y/focus-trap.directive';
import {
  BffService,
  PackageAdhocAdd,
  PackageCatalog,
  PackageGroup,
  PackageRoleTiers,
  PackageSelection,
} from '../bff.service';

/** A flattened, renderable view of one platform package group (base / desktop / gpu / …). */
interface GroupView {
  /** The catalog group key, e.g. `packages`, `packages-desktop`. */
  key: string;
  /** The builder gate name (`base`, `desktop`, `k8s`, `gpu`, …). */
  gate: string;
  /** A human heading for the group. */
  title: string;
  /** True for the always-on essential floor (`gate === 'base'`): rendered checked + disabled. */
  essential: boolean;
  sections: { title: string; atoms: string[] }[];
}

/** One selectable adhoc add-on option (key + human label + the atoms it folds into `packages_add`). */
interface AdhocView { key: string; label: string; atoms: string[]; }

/** Pretty labels for the builder gates the tree groups by (falls back to a humanised key). */
const GATE_LABELS: Record<string, string> = {
  base: 'Base system',
  desktop: 'Desktop',
  'desktop-capable': 'Desktop — capable workstation',
  'desktop-full': 'Desktop — full (XFCE)',
  live: 'Live / installer media',
  k8s: 'Kubernetes node payload',
  gpu: 'GPU (base)',
  'gpu-nvidia': 'GPU — NVIDIA',
  'gpu-nvidia-cuda': 'GPU — NVIDIA CUDA',
  'gpu-amd-pro': 'GPU — AMD (pro)',
  'gpu-intel-pro': 'GPU — Intel (pro)',
  'edge-ai': 'Edge-AI payload',
  'media-data': 'Media / data tooling',
  'steam-native': 'Steam (native)',
};

/** Portage atom charset — mirrors the worklist.v1 `packages_add`/`packages_drop` per-atom
 *  pattern (core/config.py validate_package_atoms). Emitted atoms are filtered through it as
 *  defence-in-depth (the catalog atoms already conform; a bad atom is never put on the wire). */
const ATOM_RE = /^[a-z0-9][a-z0-9+._-]*\/[A-Za-z0-9+._-]+$/;

/**
 * The per-image PACKAGE-SELECTION modal (item 9). A tree-multiselect over the generator's
 * package catalog: the flat adhoc add-on options (`adhoc_adds`) plus the selected image's
 * per-PLATFORM package tree (`platforms.<platform>` → group-key → sections of Portage atoms).
 * It emits a {@link PackageSelection} the wizard folds into a worklist entry's per-image
 * CONTENT (`packages_add` / `packages_drop`).
 *
 * <p><b>Role tiers (preferred).</b> A newer catalog carries per-platform role→tier baselines
 * (`roles[platform][role]` → {@link PackageRoleTiers}, precomputed by the generator's
 * `package_catalog.tiers()` for a default-options image). When the map covers this entry's
 * (platform, role), the modal's LOCK/DEFAULT state comes from the tiers — the tree SHAPE stays
 * the same gate-grouped catalog tree: `essential` atoms are the locked floor (checked +
 * disabled, never emitted); `removable` atoms default to CHECKED and un-ticking one emits a
 * `packages_drop`; `available` atoms default to UNCHECKED and ticking one emits a
 * `packages_add`. An enabled adhoc option's atoms render as additional locked floor (the
 * generator's tiers() treats them as REQUIRED while the option is on) — checked + disabled —
 * but they are STILL folded into `add` on apply unless the role tier installs them anyway
 * (essential/removable): the lock is a UI affordance, not an emission filter (see below).
 *
 * <p><b>Essential floor (legacy fallback).</b> A catalog WITHOUT the `roles` maps (or one whose
 * maps do not cover this entry's platform/role) declares only the `gate:'base'` group always-on
 * (package_catalog.py: "base is always-on", the core of `essential_floor`). The modal then greys
 * (checked + disabled, never emitted) every atom in a `gate:'base'` group; everything else is a
 * toggleable EXTRA that, when checked, compiles to `packages_add` — the pre-tiers behaviour,
 * kept byte-identical.
 *
 * <p><b>Options vs atoms.</b> A WorklistEntry has no per-option flag channel (its only per-image
 * package channel is `packages_add`/`packages_drop` — `options` never reaches the builder), so
 * on BOTH paths an enabled adhoc option's atoms are folded into `add`; the role-tiers path
 * merely renders them locked, and skips only the atoms the role tier installs regardless.
 * `PackageSelection.options` carries the enabled KEYS for round-trip + display in both modes.
 *
 * <p><b>Coupling.</b> The modal is self-sufficient — it lazily fetches the catalog itself via
 * {@link BffService.imageBuildCatalog} on first open — and communicates with the wizard ONLY
 * through its `open`/`platform`/`role`/`selection` inputs and its `applied`/`dismissed` outputs
 * (the agreed thin selection interface; the wizard component is never edited from here).
 *
 * <p>a11y: `role="dialog" aria-modal="true"` with the shared {@link FocusTrapDirective}
 * (focus moves in, Tab wraps, Escape dismisses, focus is restored to the trigger on close);
 * every atom/option is a labelled checkbox; the selected count is an `aria-live` region.
 */
@Component({
  selector: 'hug-package-catalog-modal',
  standalone: true,
  imports: [FocusTrapDirective],
  templateUrl: './package-catalog-modal.component.html',
  styleUrl: './package-catalog-modal.component.scss',
})
export class PackageCatalogModalComponent {
  private readonly bff = inject(BffService);

  /** Whether the modal is shown. The catalog is lazily loaded on the first open and the
   *  working state is (re)seeded from {@link selection} on every open. */
  readonly open = input<boolean>(false);
  /** The selected image's platform — picks which `platforms.<platform>` groups to render
   *  (one of x86 | rpi5 | frite | jetson | orangepi5 | orangepizero2). */
  readonly platform = input<string>('');
  /** The selected image's Studio role id (the ROLE_CHOICES grammar, e.g. `be`, `desktop`) —
   *  picks the `roles[platform][role]` tier baseline when the catalog carries one. Empty or
   *  unknown → the legacy base-gate floor behaviour. */
  readonly role = input<string>('');
  /** A short label for the image being edited (e.g. `be.x86`) — heading context only. */
  readonly imageLabel = input<string>('');
  /** The current selection to seed the modal, so re-opening round-trips the prior choices. */
  readonly selection = input<PackageSelection | null>(null);

  /** Emitted with the composed selection when the operator applies. */
  @Output() readonly applied = new EventEmitter<PackageSelection>();
  /** Emitted when the operator cancels / dismisses (Escape, backdrop close, Cancel). */
  @Output() readonly dismissed = new EventEmitter<void>();

  /** The loaded package catalog (just the `packages` half of the served payload), or null. */
  readonly catalog = signal<PackageCatalog | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal('');

  /** Working state (Sets for O(1) toggles): enabled adhoc option keys + user-added atoms +
   *  user-dropped atoms. On the role-tiers path drops are LIVE (un-ticking a removable-tier
   *  atom adds one); on the legacy path they only ever arrive via a seed — see class doc. */
  private readonly chosenOptions = signal<ReadonlySet<string>>(new Set());
  private readonly addedAtoms = signal<ReadonlySet<string>>(new Set());
  private readonly droppedAtoms = signal<ReadonlySet<string>>(new Set());

  /** Tracks the open→close→open transition so we seed exactly once per open. */
  private wasOpen = false;

  constructor() {
    // Only `open()` is tracked; the side effects (seed + lazy fetch) run untracked so a later
    // catalog/loading write never re-triggers this effect.
    effect(() => {
      const isOpen = this.open();
      untracked(() => {
        if (isOpen && !this.wasOpen) {
          this.wasOpen = true;
          this.seedFromSelection();
          void this.ensureCatalog();
        } else if (!isOpen) {
          this.wasOpen = false;
        }
      });
    });
  }

  // ── Derived views ──────────────────────────────────────────────────────────
  /** The adhoc add-on options, alphabetised by label. */
  readonly adhocOptions = computed<AdhocView[]>(() => {
    const c = this.catalog();
    if (!c) return [];
    return Object.entries(c.adhoc_adds)
      .map(([key, v]: [string, PackageAdhocAdd]) => ({ key, label: v.label, atoms: v.atoms }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  /** The selected platform's package groups, essential floor first, else catalog order. */
  readonly groups = computed<GroupView[]>(() => {
    const c = this.catalog();
    const plat = this.platform();
    if (!c || !plat) return [];
    const platGroups = c.platforms[plat];
    if (!platGroups) return [];
    return Object.entries(platGroups)
      .map(([key, g]: [string, PackageGroup]) => ({
        key,
        gate: g.gate,
        title: GATE_LABELS[g.gate] ?? PackageCatalogModalComponent.humanizeKey(key),
        essential: g.gate === 'base',
        sections: g.sections.map((s) => ({ title: s.title, atoms: s.atoms })),
      }))
      .sort((a, b) => Number(b.essential) - Number(a.essential));
  });

  /** This entry's (platform, role) tier baseline, when the catalog carries one — null on a
   *  legacy catalog, an empty/unknown role, or a role the map does not cover (all of which
   *  fall back to the base-gate floor, byte-identical to the pre-tiers behaviour). */
  readonly roleTiers = computed<PackageRoleTiers | null>(() => {
    const c = this.catalog();
    const plat = this.platform();
    const role = this.role();
    if (!c?.roles || !plat || !role) return null;
    return c.roles[plat]?.[role] ?? null;
  });

  /** True when the role tier baseline drives the LOCK/DEFAULT state (vs the legacy floor). */
  readonly tiersActive = computed<boolean>(() => this.roleTiers() !== null);

  /** The essential floor: the role tier's `essential` list when active, else the union of
   *  atoms in every `gate:'base'` group (the legacy declared floor). These are rendered
   *  checked + disabled and are NEVER emitted (the builder always installs them). */
  readonly essentialAtoms = computed<ReadonlySet<string>>(() => {
    const tiers = this.roleTiers();
    if (tiers) return new Set(tiers.essential);
    const set = new Set<string>();
    for (const g of this.groups()) {
      if (!g.essential) continue;
      for (const s of g.sections) for (const a of s.atoms) set.add(a);
    }
    return set;
  });

  /** The full LOCKED set: the essential floor plus — on the role-tiers path only — every
   *  enabled adhoc option's atoms (REQUIRED while the option is on: the generator's tiers()
   *  treats them as floor). Locked atoms render checked + disabled and cannot be toggled or
   *  dropped; the lock does NOT govern emission (apply() still folds enabled-option atoms
   *  into `add` — the wire's only install channel). On the legacy path this is exactly
   *  {@link essentialAtoms} (option atoms stay toggleable auto-adds there — the pre-tiers
   *  behaviour). */
  readonly lockedAtoms = computed<ReadonlySet<string>>(() => {
    const essential = this.essentialAtoms();
    if (!this.tiersActive()) return essential;
    const set = new Set(essential);
    for (const a of this.atomsForOptions(this.chosenOptions())) set.add(a);
    return set;
  });

  /** The role tier's `removable` atoms — default-installed, default-CHECKED; un-ticking one
   *  emits a `packages_drop`. Empty on the legacy path (no removable tier is declared). */
  readonly removableAtoms = computed<ReadonlySet<string>>(() =>
    new Set(this.roleTiers()?.removable ?? []),
  );

  /** True when a platform is selected but the catalog publishes no tree for it. */
  readonly noPlatformTree = computed(
    () => !!this.catalog() && !!this.platform() && this.groups().length === 0,
  );

  /** The live count of operator-chosen items (added atoms + enabled options). */
  readonly selectedCount = computed(() => this.addedAtoms().size + this.chosenOptions().size);

  // ── Checkbox state / toggles ─────────────────────────────────────────────────
  /** An atom is checked when it is locked floor, a default-installed (removable) atom the
   *  operator has not dropped, or an extra the operator added. */
  atomChecked(atom: string): boolean {
    if (this.lockedAtoms().has(atom)) return true;
    if (this.removableAtoms().has(atom)) return !this.droppedAtoms().has(atom);
    return this.addedAtoms().has(atom);
  }

  /** Locked atoms — the essential floor, plus enabled-option atoms on the role-tiers path —
   *  are checked + disabled. */
  atomDisabled(atom: string): boolean {
    return this.lockedAtoms().has(atom);
  }

  /** Toggle an atom. Locked atoms are ignored. A REMOVABLE atom (role-tiers path only) is
   *  default-installed, so un-ticking it emits a `packages_drop` (and re-ticking clears the
   *  drop); any other atom is an EXTRA toggled into / out of `packages_add`. */
  toggleAtom(atom: string, checked: boolean): void {
    if (this.lockedAtoms().has(atom)) return;
    if (this.removableAtoms().has(atom)) {
      this.droppedAtoms.update((cur) => {
        const next = new Set(cur);
        if (checked) next.delete(atom);
        else next.add(atom);
        return next;
      });
      return;
    }
    this.addedAtoms.update((cur) => {
      const next = new Set(cur);
      if (checked) next.add(atom);
      else next.delete(atom);
      return next;
    });
  }

  optionChecked(key: string): boolean {
    return this.chosenOptions().has(key);
  }

  toggleOption(key: string, checked: boolean): void {
    this.chosenOptions.update((cur) => {
      const next = new Set(cur);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  /** Compose the {@link PackageSelection} and emit it, filtered to valid atoms.
   *
   *  <p>BOTH paths fold every enabled adhoc option's atoms into `add`: `packages_add` is the
   *  ONLY wire channel that installs them (a {@link WorklistEntry} has no per-option flag
   *  channel — `options` is round-trip-only and never reaches the builder), so the role-tiers
   *  visual LOCK on option atoms is a UI affordance, never an emission filter.
   *
   *  <p>LEGACY path (no role tiers): `add` = the user's extra atoms plus the enabled options'
   *  atoms, minus the essential floor; `drop` passes seeded drops through — byte-identical to
   *  the pre-tiers behaviour.
   *
   *  <p>ROLE-TIERS path: the same fold, but `add` excludes exactly what the builder installs
   *  regardless — the role's essential floor and its removable tier (default-installed; a
   *  removable atom's only signal is a `drop` when un-ticked, and while an option locks it
   *  no drop can exist). `drop` excludes anything locked or simultaneously added (defence
   *  against a stale/contradictory seed). */
  apply(): void {
    const options = [...this.chosenOptions()].sort();
    const optionAtoms = this.atomsForOptions(this.chosenOptions());
    const tiers = this.tiersActive();
    const essential = this.essentialAtoms();
    const locked = this.lockedAtoms();
    const removable = this.removableAtoms();
    const addSource = new Set([...this.addedAtoms(), ...optionAtoms]);
    // On the legacy path `essential` IS the locked set and `removable` is empty, so this one
    // filter keeps the legacy emission byte-identical while letting locked-but-not-installed
    // option atoms ride `add` on the role-tiers path.
    const add = [...addSource]
      .filter((a) => !essential.has(a) && !removable.has(a) && ATOM_RE.test(a))
      .sort();
    const addSet = new Set(add);
    const drop = [...this.droppedAtoms()]
      .filter((a) => ATOM_RE.test(a) && (!tiers || (!locked.has(a) && !addSet.has(a))))
      .sort();
    this.applied.emit({ add, drop, options });
  }

  /** The union of catalog atoms contributed by the given adhoc-option keys ({} when the catalog is
   *  not loaded — safe: options are only non-empty on a re-edit, by when this persistent modal has
   *  the catalog cached from its first open). */
  private atomsForOptions(keys: ReadonlySet<string>): ReadonlySet<string> {
    const c = this.catalog();
    const atoms = new Set<string>();
    if (c) {
      for (const key of keys) {
        for (const a of c.adhoc_adds[key]?.atoms ?? []) atoms.add(a);
      }
    }
    return atoms;
  }

  cancel(): void {
    this.dismissed.emit();
  }

  // ── Internals ────────────────────────────────────────────────────────────────
  private seedFromSelection(): void {
    const sel = this.selection();
    this.chosenOptions.set(new Set(sel?.options ?? []));
    this.addedAtoms.set(new Set(sel?.add ?? []));
    this.droppedAtoms.set(new Set(sel?.drop ?? []));
    // If the catalog is already cached (a re-open of this persistent modal), drop the option-
    // derived atoms now; if it loads later, ensureCatalog() reconciles them (see below).
    this.reconcileOptionAtoms();
  }

  /**
   * Remove the seeded options' atoms from {@link addedAtoms}. On BOTH paths sel.add carries the
   * FULL folded atom set (a prior apply() emitted addedAtoms ∪ optionAtoms), but those
   * option-derived atoms are represented by {@link chosenOptions} — keeping them in addedAtoms
   * too would let a later un-tick of the option FAIL to clear them (apply() would re-emit them).
   * This is a pure DEDUP, never a removal from the wire: apply() re-folds the enabled options'
   * atoms from {@link chosenOptions}, so a legacy-era seed re-opened under a role-tiered catalog
   * keeps its option packages installed. Runs on seed AND again once the catalog first resolves
   * (it can arrive after seed); no user edit can occur in between because the package tree only
   * renders after the catalog loads. No-op when no options are set.
   */
  private reconcileOptionAtoms(): void {
    const optionAtoms = this.atomsForOptions(this.chosenOptions());
    if (!optionAtoms.size) return;
    this.addedAtoms.update((cur) => new Set([...cur].filter((a) => !optionAtoms.has(a))));
  }

  private async ensureCatalog(): Promise<void> {
    if (this.catalog() || this.loading()) return;
    this.loading.set(true);
    this.loadError.set('');
    try {
      const payload = await this.bff.imageBuildCatalog();
      if (payload?.packages) {
        this.catalog.set(payload.packages);
        // The catalog just became available — drop any seeded option atoms from addedAtoms now
        // (they could not be resolved at seed time on this modal's first-ever open).
        this.reconcileOptionAtoms();
      } else {
        this.loadError.set('The package catalog is not available.');
      }
    } catch {
      this.loadError.set('The package catalog could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  /** `packages-desktop-full` → `Desktop full`. */
  private static humanizeKey(key: string): string {
    const s = key.replace(/^packages-?/, '').replace(/-/g, ' ').trim();
    if (!s) return 'Base system';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
