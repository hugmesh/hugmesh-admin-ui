import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PackageCatalogModalComponent } from './package-catalog-modal.component';
import { BffService, ImageBuildCatalog, PackageSelection } from '../bff.service';

/** A compact LEGACY catalog fixture (NO `roles` tier maps) mirroring the served shapes.
 *  `app-misc/jq` appears in BOTH the base (essential) group AND the desktop group — it must
 *  be locked in both. */
function catalog(): ImageBuildCatalog {
  return {
    packages: {
      adhoc_adds: {
        tor: { atoms: ['net-vpn/tor'], label: 'Tor onion service' },
        'yubikey-login': { atoms: ['sys-auth/pam-u2f'], label: 'YubiKey login' },
      },
      platforms: {
        x86: {
          packages: {
            gate: 'base',
            sections: [{ title: 'Kernel', atoms: ['sys-kernel/gentoo-sources', 'app-misc/jq'] }],
          },
          'packages-desktop': {
            gate: 'desktop',
            sections: [{ title: '', atoms: ['kde-plasma/plasma-meta', 'app-misc/jq'] }],
          },
          'packages-gpu-nvidia': {
            gate: 'gpu-nvidia',
            sections: [{ title: '', atoms: ['x11-drivers/nvidia-drivers'] }],
          },
        },
      },
    },
    images: { platform_labels: {}, role_class: { desktop: [], node: [] }, roles: {} },
  };
}

/** The legacy fixture EXTENDED with a k8s group, a media group carrying tor's atom, and the
 *  per-platform `roles` tier maps (mirroring the generator's tiers() output): a NODE role
 *  (`be`) whose essential floor includes the k8s payload, and a DESKTOP role whose floor does
 *  not (the k8s atoms are merely available there). Tor's atom is in the x86 tree so option
 *  locking is observable on the tree checkbox itself. */
function tieredCatalog(): ImageBuildCatalog {
  const c = catalog();
  // An option whose atoms OVERLAP the be role's tiers: kubernetes is be-essential, nvidia is
  // be-removable, tor's atom is be-available — so a fold-into-add must emit ONLY the atom the
  // role does not already install.
  c.packages.adhoc_adds['cluster-pin'] = {
    atoms: ['sys-cluster/kubernetes', 'x11-drivers/nvidia-drivers', 'net-vpn/tor'],
    label: 'Cluster pin (floor-overlap fixture)',
  };
  c.packages.platforms['x86']['packages-k8s'] = {
    gate: 'k8s',
    sections: [{ title: '', atoms: ['sys-cluster/kubernetes', 'app-containers/containerd'] }],
  };
  c.packages.platforms['x86']['packages-media-data'] = {
    gate: 'media-data',
    sections: [{ title: '', atoms: ['net-vpn/tor'] }],
  };
  c.packages.roles = {
    x86: {
      be: {
        essential: [
          'app-containers/containerd',
          'app-misc/jq',
          'sys-cluster/kubernetes',
          'sys-kernel/gentoo-sources',
        ],
        removable: ['x11-drivers/nvidia-drivers'],
        available: ['kde-plasma/plasma-meta', 'net-vpn/tor'],
      },
      desktop: {
        essential: ['app-misc/jq', 'kde-plasma/plasma-meta', 'sys-kernel/gentoo-sources'],
        removable: [],
        available: [
          'app-containers/containerd',
          'net-vpn/tor',
          'sys-cluster/kubernetes',
          'x11-drivers/nvidia-drivers',
        ],
      },
    },
  };
  return c;
}

describe('PackageCatalogModalComponent', () => {
  let fixture: ComponentFixture<PackageCatalogModalComponent>;
  let component: PackageCatalogModalComponent;
  let bff: jasmine.SpyObj<BffService>;

  function configure(): void {
    bff = jasmine.createSpyObj<BffService>('BffService', ['imageBuildCatalog']);
    bff.imageBuildCatalog.and.resolveTo(catalog());
    TestBed.configureTestingModule({
      imports: [PackageCatalogModalComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });
    fixture = TestBed.createComponent(PackageCatalogModalComponent);
    component = fixture.componentInstance;
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function q(testid: string): HTMLElement | null {
    return el().querySelector(`[data-testid="${testid}"]`);
  }
  function checkbox(testid: string): HTMLInputElement {
    return q(testid) as HTMLInputElement;
  }

  /** Set the inputs, open the modal, and flush the catalog fetch + render. */
  async function open(
    platform = 'x86',
    selection: PackageSelection | null = null,
    role = '',
  ): Promise<void> {
    fixture.componentRef.setInput('platform', platform);
    fixture.componentRef.setInput('role', role);
    fixture.componentRef.setInput('selection', selection);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Toggle a rendered checkbox through the DOM (proves the template wiring end-to-end). */
  function setChecked(testid: string, checked: boolean): void {
    const box = checkbox(testid);
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(() => configure());

  it('renders nothing (no dialog) while closed and does NOT fetch the catalog', () => {
    fixture.detectChanges();
    expect(q('pkg-modal')).toBeNull();
    expect(bff.imageBuildCatalog).not.toHaveBeenCalled();
  });

  it('lazily fetches the catalog on the first open and renders the dialog', async () => {
    await open();
    expect(bff.imageBuildCatalog).toHaveBeenCalledTimes(1);
    const dialog = q('pkg-modal')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The essential-floor note is always shown, naming the platform.
    expect(q('pkg-essential-note')!.textContent).toContain('x86');
  });

  it('renders the adhoc options + the platform package groups (essential floor first)', async () => {
    await open();
    expect(q('pkg-adhoc')).not.toBeNull();
    expect(q('pkg-opt-tor')).not.toBeNull();
    // Groups present for every platform key.
    expect(q('pkg-group-packages')).not.toBeNull();
    expect(q('pkg-group-packages-desktop')).not.toBeNull();
    expect(q('pkg-group-packages-gpu-nvidia')).not.toBeNull();
    // The base group carries the locked badge + comes first in DOM order.
    const groups = Array.from(el().querySelectorAll('[data-testid^="pkg-group-"]'));
    expect(groups[0].getAttribute('data-testid')).toBe('pkg-group-packages');
    expect(q('pkg-locked-badge')).not.toBeNull();
  });

  it('greys (checked + disabled) every essential-floor atom, including where it recurs in a non-base group', async () => {
    await open();
    // Base atoms are locked ON.
    const base = checkbox('pkg-atom-sys-kernel/gentoo-sources');
    expect(base.checked).toBeTrue();
    expect(base.disabled).toBeTrue();
    // app-misc/jq is essential (base) — it also appears under the desktop group, so it renders
    // TWICE; EVERY occurrence must be locked (querySelectorAll, not just the first checkbox).
    const jqBoxes = Array.from(
      el().querySelectorAll<HTMLInputElement>('[data-testid="pkg-atom-app-misc/jq"]'),
    );
    expect(jqBoxes.length).toBe(2);
    for (const jq of jqBoxes) {
      expect(jq.checked).toBeTrue();
      expect(jq.disabled).toBeTrue();
    }
    // A non-essential atom is unchecked + toggleable.
    const plasma = checkbox('pkg-atom-kde-plasma/plasma-meta');
    expect(plasma.checked).toBeFalse();
    expect(plasma.disabled).toBeFalse();
  });

  it('emits a selection folding checked extras + enabled option atoms into add, never the floor', async () => {
    await open();
    const emitted: PackageSelection[] = [];
    component.applied.subscribe((s) => emitted.push(s));

    // Toggle a non-base atom via the DOM checkbox (proves the wiring), and an option via method.
    const plasma = checkbox('pkg-atom-kde-plasma/plasma-meta');
    plasma.checked = true;
    plasma.dispatchEvent(new Event('change'));
    component.toggleOption('tor', true);
    fixture.detectChanges();

    // The count reflects added atom + option (never essential atoms).
    expect(q('pkg-count')!.textContent).toContain('2 selected');

    (q('pkg-apply') as HTMLButtonElement).click();
    expect(emitted.length).toBe(1);
    const sel = emitted[0];
    // The option's atoms are folded into add; the essential floor is NEVER present.
    expect(sel.add).toEqual(['kde-plasma/plasma-meta', 'net-vpn/tor']);
    expect(sel.add).not.toContain('sys-kernel/gentoo-sources');
    expect(sel.add).not.toContain('app-misc/jq');
    expect(sel.options).toEqual(['tor']);
    expect(sel.drop).toEqual([]);
  });

  it('seeds the working state from the selection input and round-trips it, preserving drops', async () => {
    const seed: PackageSelection = {
      add: ['kde-plasma/plasma-meta'],
      drop: ['media-video/vlc'],
      options: ['yubikey-login'],
    };
    await open('x86', seed);
    // The seeded add + option are pre-checked.
    expect(checkbox('pkg-atom-kde-plasma/plasma-meta').checked).toBeTrue();
    expect(checkbox('pkg-opt-yubikey-login').checked).toBeTrue();

    const emitted: PackageSelection[] = [];
    component.applied.subscribe((s) => emitted.push(s));
    (q('pkg-apply') as HTMLButtonElement).click();
    const sel = emitted[0];
    // yubikey-login folds sys-auth/pam-u2f into add; the seeded drop survives untouched.
    expect(sel.add).toEqual(['kde-plasma/plasma-meta', 'sys-auth/pam-u2f']);
    expect(sel.options).toEqual(['yubikey-login']);
    expect(sel.drop).toEqual(['media-video/vlc']);
  });

  it('un-ticking a seeded option removes its already-folded atoms (real re-edit round-trip)', async () => {
    // A prior apply folded tor's atom (net-vpn/tor) into add and recorded options:['tor'] — the
    // exact shape a re-edit seeds. Un-ticking tor must now REMOVE net-vpn/tor, not leave it stuck
    // in addedAtoms where apply() would re-emit it.
    await open('x86', { add: ['net-vpn/tor'], drop: [], options: ['tor'] });
    expect(checkbox('pkg-opt-tor').checked).toBeTrue(); // the option is restored as checked

    const emitted: PackageSelection[] = [];
    component.applied.subscribe((s) => emitted.push(s));
    component.toggleOption('tor', false);
    (q('pkg-apply') as HTMLButtonElement).click();
    const sel = emitted[0];
    expect(sel.options).toEqual([]);
    expect(sel.add).not.toContain('net-vpn/tor'); // gone, not stuck in addedAtoms
  });

  it('emits dismissed from both the Cancel button and the header close', async () => {
    await open();
    const spy = jasmine.createSpy('dismissed');
    component.dismissed.subscribe(spy);
    (q('pkg-cancel') as HTMLButtonElement).click();
    (q('pkg-close') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shows an honest error (and disables Apply) when the catalog is unavailable', async () => {
    bff.imageBuildCatalog.and.resolveTo(null);
    await open();
    expect(q('pkg-error')).not.toBeNull();
    expect(q('pkg-group-packages')).toBeNull();
    expect((q('pkg-apply') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('shows a no-tree note when the platform has no published package groups', async () => {
    await open('orangepizero2');
    expect(q('pkg-no-platform')).not.toBeNull();
    expect(q('pkg-no-platform')!.textContent).toContain('orangepizero2');
    // Adhoc options are still offered (they are platform-independent).
    expect(q('pkg-adhoc')).not.toBeNull();
  });

  it('does not re-fetch the catalog on a second open', async () => {
    await open();
    expect(bff.imageBuildCatalog).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(bff.imageBuildCatalog).toHaveBeenCalledTimes(1);
  });

  // ── Role tiers: `roles[platform][role]` drives the LOCK/DEFAULT state ────────
  describe('role tiers', () => {
    beforeEach(() => bff.imageBuildCatalog.and.resolveTo(tieredCatalog()));

    function collect(): PackageSelection[] {
      const emitted: PackageSelection[] = [];
      component.applied.subscribe((s) => emitted.push(s));
      return emitted;
    }

    it('locks the role floor: a NODE role locks the k8s payload atoms', async () => {
      await open('x86', null, 'be');
      // The k8s payload is in be's essential tier — locked, even though its group gate is
      // 'k8s' (not 'base'): the floor is role-derived, no longer the base-gate heuristic.
      for (const atom of ['sys-cluster/kubernetes', 'app-containers/containerd']) {
        const box = checkbox(`pkg-atom-${atom}`);
        expect(box.checked).withContext(atom).toBeTrue();
        expect(box.disabled).withContext(atom).toBeTrue();
      }
      // The base-list atoms stay locked (they are in the role's essential tier too).
      expect(checkbox('pkg-atom-sys-kernel/gentoo-sources').disabled).toBeTrue();
      // A role-essential atom rendered in TWO groups (jq: base + desktop) is locked at EVERY
      // occurrence — the lock is keyed on the atom, never on the group context.
      const jqBoxes = Array.from(
        el().querySelectorAll<HTMLInputElement>('[data-testid="pkg-atom-app-misc/jq"]'),
      );
      expect(jqBoxes.length).toBe(2);
      for (const jq of jqBoxes) {
        expect(jq.checked).toBeTrue();
        expect(jq.disabled).toBeTrue();
      }
      // An available-tier atom defaults to unchecked + toggleable.
      const plasma = checkbox('pkg-atom-kde-plasma/plasma-meta');
      expect(plasma.checked).toBeFalse();
      expect(plasma.disabled).toBeFalse();
      // The note names the role (the tiers are live here, not builder-deferred).
      expect(q('pkg-essential-note')!.textContent).toContain('be');
      expect(q('pkg-essential-note')!.textContent).toContain('x86');
    });

    it('does NOT lock the k8s atoms for a DESKTOP role (its own floor locks the desktop meta)', async () => {
      await open('x86', null, 'desktop');
      for (const atom of ['sys-cluster/kubernetes', 'app-containers/containerd']) {
        const box = checkbox(`pkg-atom-${atom}`);
        expect(box.checked).withContext(atom).toBeFalse();
        expect(box.disabled).withContext(atom).toBeFalse();
      }
      // The desktop role's floor locks its own payload instead.
      const plasma = checkbox('pkg-atom-kde-plasma/plasma-meta');
      expect(plasma.checked).toBeTrue();
      expect(plasma.disabled).toBeTrue();
    });

    it('renders a removable-tier atom checked by default; un-ticking it emits a drop (re-ticking clears it)', async () => {
      await open('x86', null, 'be');
      const emitted = collect();
      // nvidia is default-installed (removable) for be: checked but NOT locked.
      const nvidia = checkbox('pkg-atom-x11-drivers/nvidia-drivers');
      expect(nvidia.checked).toBeTrue();
      expect(nvidia.disabled).toBeFalse();

      setChecked('pkg-atom-x11-drivers/nvidia-drivers', false);
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].drop).toEqual(['x11-drivers/nvidia-drivers']);
      expect(emitted[0].add).toEqual([]);

      // Re-ticking clears the drop again.
      setChecked('pkg-atom-x11-drivers/nvidia-drivers', true);
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[1].drop).toEqual([]);
      expect(emitted[1].add).toEqual([]);
    });

    it('emits a checked available-tier atom as an add (and never the floor)', async () => {
      await open('x86', null, 'be');
      const emitted = collect();
      setChecked('pkg-atom-kde-plasma/plasma-meta', true);
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].add).toEqual(['kde-plasma/plasma-meta']);
      expect(emitted[0].drop).toEqual([]);
      // The role floor (k8s payload + base list) is never emitted.
      expect(emitted[0].add).not.toContain('sys-cluster/kubernetes');
      expect(emitted[0].add).not.toContain('sys-kernel/gentoo-sources');
    });

    it('locks an enabled option\'s atoms in the tree AND still folds them into add (unlocking on un-tick)', async () => {
      await open('x86', null, 'be');
      const emitted = collect();
      // Before: tor's atom is a plain available atom.
      expect(checkbox('pkg-atom-net-vpn/tor').checked).toBeFalse();
      expect(checkbox('pkg-atom-net-vpn/tor').disabled).toBeFalse();

      // Enabling the option locks its atom (checked + disabled) — it is REQUIRED now.
      setChecked('pkg-opt-tor', true);
      expect(checkbox('pkg-atom-net-vpn/tor').checked).toBeTrue();
      expect(checkbox('pkg-atom-net-vpn/tor').disabled).toBeTrue();

      // REGRESSION (mustFix): the wire has NO per-option channel (WorklistEntry.options never
      // reaches the builder), so `packages_add` is the ONLY channel that installs an option's
      // atoms — the visual lock must not filter them off the wire.
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].options).toEqual(['tor']);
      expect(emitted[0].add).toEqual(['net-vpn/tor']);
      expect(emitted[0].drop).toEqual([]);

      // Un-ticking the option unlocks the atom again and removes it from add.
      setChecked('pkg-opt-tor', false);
      expect(checkbox('pkg-atom-net-vpn/tor').checked).toBeFalse();
      expect(checkbox('pkg-atom-net-vpn/tor').disabled).toBeFalse();
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[1].options).toEqual([]);
      expect(emitted[1].add).toEqual([]);
    });

    it('folds an enabled option into add ONLY where the role tier does not already install it', async () => {
      await open('x86', null, 'be');
      const emitted = collect();
      // cluster-pin carries a be-ESSENTIAL atom (kubernetes: installed regardless, never
      // emitted), a be-REMOVABLE atom (nvidia: default-installed, locked while the option is
      // on so it cannot be dropped), and a be-AVAILABLE atom (tor's) that MUST ride add.
      setChecked('pkg-opt-cluster-pin', true);
      expect(checkbox('pkg-atom-x11-drivers/nvidia-drivers').disabled).toBeTrue();
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].add).toEqual(['net-vpn/tor']);
      expect(emitted[0].drop).toEqual([]);
      expect(emitted[0].options).toEqual(['cluster-pin']);
    });

    it('keeps a LEGACY-era folded option atom installed when re-edited under a tiered catalog', async () => {
      // Pre-tiers, apply() folded tor's atom into add (add:['net-vpn/tor'] + options:['tor']).
      // Re-opening that entry under the role-tiered catalog dedups the atom out of addedAtoms
      // (reconcileOptionAtoms); apply() must re-fold it onto the wire — otherwise a
      // previously-working install silently disappears on the next re-apply (the mustFix's
      // compounding half).
      await open('x86', { add: ['net-vpn/tor'], drop: [], options: ['tor'] }, 'be');
      expect(checkbox('pkg-atom-net-vpn/tor').disabled).toBeTrue(); // locked while tor is on
      const emitted = collect();
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].add).toEqual(['net-vpn/tor']);
      expect(emitted[0].options).toEqual(['tor']);
    });

    it('round-trips a tiered selection (seeded add + drop + option) as a stable fixpoint', async () => {
      // The seed is exactly what a prior tiers-path apply() emitted (tor's atom folded into
      // add) — re-applying without edits must emit the identical selection.
      await open(
        'x86',
        {
          add: ['kde-plasma/plasma-meta', 'net-vpn/tor'],
          drop: ['x11-drivers/nvidia-drivers'],
          options: ['tor'],
        },
        'be',
      );
      // Seeded state renders: the added available atom checked, the dropped removable atom
      // unchecked, the option's atom locked.
      expect(checkbox('pkg-atom-kde-plasma/plasma-meta').checked).toBeTrue();
      expect(checkbox('pkg-atom-x11-drivers/nvidia-drivers').checked).toBeFalse();
      expect(checkbox('pkg-atom-net-vpn/tor').disabled).toBeTrue();

      const emitted = collect();
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0]).toEqual({
        add: ['kde-plasma/plasma-meta', 'net-vpn/tor'],
        drop: ['x11-drivers/nvidia-drivers'],
        options: ['tor'],
      });
    });

    it('never emits a drop of the locked floor, even from a stale seed', async () => {
      // A stale/contradictory seed tries to drop a floor atom (kubernetes is be-essential).
      await open('x86', { add: [], drop: ['sys-cluster/kubernetes'], options: [] }, 'be');
      const emitted = collect();
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].drop).toEqual([]);
    });

    it('falls back to the legacy behaviour for a role the tier maps do not cover', async () => {
      await open('x86', null, 'pki'); // roles.x86 only maps be + desktop
      // Base-gate floor only: the k8s group is NOT locked…
      const k8s = checkbox('pkg-atom-sys-cluster/kubernetes');
      expect(k8s.checked).toBeFalse();
      expect(k8s.disabled).toBeFalse();
      // …the base group is.
      expect(checkbox('pkg-atom-sys-kernel/gentoo-sources').disabled).toBeTrue();

      // Option atoms are auto-added-not-locked (the legacy fold), exactly as today.
      const emitted = collect();
      setChecked('pkg-opt-tor', true);
      expect(checkbox('pkg-atom-net-vpn/tor').disabled).toBeFalse();
      (q('pkg-apply') as HTMLButtonElement).click();
      expect(emitted[0].add).toEqual(['net-vpn/tor']);
      expect(emitted[0].options).toEqual(['tor']);
    });
  });

  // ── Legacy fallback: a catalog with NO roles key ignores the role input ──────
  describe('legacy catalog fallback (no roles key)', () => {
    it('keeps the base-gate floor + option fold byte-identical even when a role is provided', async () => {
      // The DEFAULT (roles-less) catalog + a role that WOULD be tiered on a newer catalog.
      await open('x86', { add: [], drop: ['media-video/vlc'], options: [] }, 'be');
      // Floor = base gate only; nothing else locked, nothing default-checked.
      expect(checkbox('pkg-atom-sys-kernel/gentoo-sources').disabled).toBeTrue();
      expect(checkbox('pkg-atom-app-misc/jq').disabled).toBeTrue();
      const nvidia = checkbox('pkg-atom-x11-drivers/nvidia-drivers');
      expect(nvidia.checked).toBeFalse();
      expect(nvidia.disabled).toBeFalse();

      const emitted: PackageSelection[] = [];
      component.applied.subscribe((s) => emitted.push(s));
      // The legacy fold: an enabled option's atoms go INTO add (not locked)…
      setChecked('pkg-opt-tor', true);
      setChecked('pkg-atom-kde-plasma/plasma-meta', true);
      (q('pkg-apply') as HTMLButtonElement).click();
      // …and the seeded drop passes through untouched — the exact pre-tiers emission.
      expect(emitted[0]).toEqual({
        add: ['kde-plasma/plasma-meta', 'net-vpn/tor'],
        drop: ['media-video/vlc'],
        options: ['tor'],
      });
    });
  });
});
