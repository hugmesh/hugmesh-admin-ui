import { Component, EventEmitter, Output, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FocusTrapDirective } from '../a11y/focus-trap.directive';
import {
  BffService,
  PackageAdhocAdd,
  PackageCatalog,
  PackageGroup,
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
 * <p><b>Essential floor.</b> The catalog does NOT declare a full tier split — only the
 * `gate:'base'` group is declared always-on (package_catalog.py: "base is always-on", and it
 * is the core of `essential_floor`). So the modal greys (checked + disabled, never emitted)
 * every atom in a `gate:'base'` group; everything else is a toggleable EXTRA that, when
 * checked, compiles to `packages_add`. The LIVE tier resolution — which default packages are
 * removable (→ `packages_drop`) and which extras a given role auto-installs, via
 * `package_catalog.tiers()` — needs Python in the image-gen container and is DEFERRED/STRUCTURAL;
 * the modal documents this in-surface and rides the static tree meanwhile (design decision:
 * "static tree now, essentials-greying via the declared floor, live tiers deferred").
 *
 * <p><b>Options vs atoms.</b> A WorklistEntry has no per-option flag channel (its only per-image
 * package channel is `packages_add`/`packages_drop`), so an enabled adhoc option's atoms are
 * folded into `add`. `PackageSelection.options` carries the enabled KEYS purely for round-trip +
 * display.
 *
 * <p><b>Coupling.</b> The modal is self-sufficient — it lazily fetches the catalog itself via
 * {@link BffService.imageBuildCatalog} on first open — and communicates with the wizard ONLY
 * through its `open`/`platform`/`selection` inputs and its `applied`/`dismissed` outputs (the
 * agreed thin selection interface; the wizard component is never edited from here).
 *
 * <p>a11y: `role="dialog" aria-modal="true"` with the shared {@link FocusTrapDirective}
 * (focus moves in, Tab wraps, Escape dismisses, focus is restored to the trigger on close);
 * every atom/option is a labelled checkbox; the selected count is an `aria-live` region.
 */
@Component({
  selector: 'snap-package-catalog-modal',
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
   *  user-dropped atoms (drops only ever arrive via a seed under the static tree — see class
   *  doc; the modal itself does not add new drops until live tiers land). */
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

  /** The union of atoms in every `gate:'base'` group — the declared essential floor. These are
   *  rendered checked + disabled and are NEVER emitted (the builder always installs them). */
  readonly essentialAtoms = computed<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const g of this.groups()) {
      if (!g.essential) continue;
      for (const s of g.sections) for (const a of s.atoms) set.add(a);
    }
    return set;
  });

  /** True when a platform is selected but the catalog publishes no tree for it. */
  readonly noPlatformTree = computed(
    () => !!this.catalog() && !!this.platform() && this.groups().length === 0,
  );

  /** The live count of operator-chosen items (added atoms + enabled options). */
  readonly selectedCount = computed(() => this.addedAtoms().size + this.chosenOptions().size);

  // ── Checkbox state / toggles ─────────────────────────────────────────────────
  /** An atom is checked when it is in the essential floor OR the operator added it. */
  atomChecked(atom: string): boolean {
    return this.essentialAtoms().has(atom) || this.addedAtoms().has(atom);
  }

  /** Essential-floor atoms are locked (checked + disabled). */
  atomDisabled(atom: string): boolean {
    return this.essentialAtoms().has(atom);
  }

  /** Toggle an EXTRA atom into / out of `packages_add`. Locked (essential) atoms are ignored. */
  toggleAtom(atom: string, checked: boolean): void {
    if (this.essentialAtoms().has(atom)) return;
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
  /** Compose the {@link PackageSelection} and emit it. `add` = the user's extra atoms plus the
   *  atoms of every enabled adhoc option, minus the essential floor, filtered to valid atoms. */
  apply(): void {
    const options = [...this.chosenOptions()].sort();
    const c = this.catalog();
    const optionAtoms = new Set<string>();
    if (c) {
      for (const key of options) {
        for (const a of c.adhoc_adds[key]?.atoms ?? []) optionAtoms.add(a);
      }
    }
    const essential = this.essentialAtoms();
    const add = [...new Set([...this.addedAtoms(), ...optionAtoms])]
      .filter((a) => !essential.has(a) && ATOM_RE.test(a))
      .sort();
    const drop = [...this.droppedAtoms()].filter((a) => ATOM_RE.test(a)).sort();
    this.applied.emit({ add, drop, options });
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
  }

  private async ensureCatalog(): Promise<void> {
    if (this.catalog() || this.loading()) return;
    this.loading.set(true);
    this.loadError.set('');
    try {
      const payload = await this.bff.imageBuildCatalog();
      if (payload?.packages) this.catalog.set(payload.packages);
      else this.loadError.set('The package catalog is not available.');
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
