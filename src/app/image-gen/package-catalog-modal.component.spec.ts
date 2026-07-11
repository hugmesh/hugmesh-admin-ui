import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PackageCatalogModalComponent } from './package-catalog-modal.component';
import { BffService, ImageBuildCatalog, PackageSelection } from '../bff.service';

/** A compact catalog fixture mirroring the served shapes. `app-misc/jq` appears in BOTH the
 *  base (essential) group AND the desktop group — it must be locked in both. */
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
  async function open(platform = 'x86', selection: PackageSelection | null = null): Promise<void> {
    fixture.componentRef.setInput('platform', platform);
    fixture.componentRef.setInput('selection', selection);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
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
    // app-misc/jq is essential (base) — even though it also appears under the desktop group, it
    // is a single locked checkbox and never toggleable.
    const jq = checkbox('pkg-atom-app-misc/jq');
    expect(jq.checked).toBeTrue();
    expect(jq.disabled).toBeTrue();
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
});
