import { TestBed } from '@angular/core/testing';
import { PlatformCapabilitiesService } from './platform-capabilities.service';
import { BffService, PlatformCapabilities, PLATFORM_CAPABILITIES_ABSENT } from '../bff.service';

describe('PlatformCapabilitiesService', () => {
  let bff: jasmine.SpyObj<BffService>;

  function caps(over: Partial<PlatformCapabilities> = {}): PlatformCapabilities {
    return { ...PLATFORM_CAPABILITIES_ABSENT, ...over };
  }

  function setup(value: PlatformCapabilities): PlatformCapabilitiesService {
    bff = jasmine.createSpyObj<BffService>('BffService', ['platformCapabilities']);
    bff.platformCapabilities.and.resolveTo(value);
    TestBed.configureTestingModule({
      providers: [{ provide: BffService, useValue: bff }],
    });
    return TestBed.inject(PlatformCapabilitiesService);
  }

  it('starts not-ready, then exposes the loaded envelope', async () => {
    const svc = setup(caps({ veleroPresent: true, argocdPresent: true }));
    expect(svc.ready()).toBeFalse();
    await svc.load();
    expect(svc.ready()).toBeTrue();
    expect(svc.veleroPresent()).toBeTrue();
    expect(svc.argocdPresent()).toBeTrue();
    expect(svc.buildNodePresent()).toBeFalse();
  });

  it('reflects each capability signal from the envelope', async () => {
    const svc = setup(caps({ imagesGenerated: true, warnings: ['x'] }));
    await svc.load();
    expect(svc.imagesGenerated()).toBeTrue();
    expect(svc.veleroPresent()).toBeFalse();
    expect(svc.warnings()).toEqual(['x']);
  });

  it('loads ONCE and de-dupes concurrent callers', async () => {
    const svc = setup(caps({ veleroPresent: true }));
    await Promise.all([svc.load(), svc.load(), svc.load()]);
    await svc.load();
    expect(bff.platformCapabilities).toHaveBeenCalledTimes(1);
  });

  it('reload() forces a fresh fetch', async () => {
    const svc = setup(caps({ veleroPresent: false }));
    await svc.load();
    bff.platformCapabilities.and.resolveTo(caps({ veleroPresent: true }));
    await svc.reload();
    expect(bff.platformCapabilities).toHaveBeenCalledTimes(2);
    expect(svc.veleroPresent()).toBeTrue();
  });

  it('capability signals are false while unknown (fail-closed display)', () => {
    const svc = setup(caps({ veleroPresent: true }));
    // before load() resolves, everything reads false.
    expect(svc.veleroPresent()).toBeFalse();
    expect(svc.argocdPresent()).toBeFalse();
  });

  // ── warningFor(capability): ties a warning to a capability (undetectable vs probed-absent) ──

  it('warningFor() returns null when there is no matching warning (genuinely probed-absent)', async () => {
    const svc = setup(caps({ warnings: [] }));
    await svc.load();
    expect(svc.warningFor('argocd')()).toBeNull();
    expect(svc.warningFor('velero')()).toBeNull();
    expect(svc.warningFor('buildNode')()).toBeNull();
    expect(svc.warningFor('images')()).toBeNull();
  });

  it('warningFor() matches the cluster-wide NOT_WIRED notice for argocd/velero/buildNode but NOT images', async () => {
    const notWired =
      'Platform-capability k8s probe is not enabled on this deployment '
      + '(app.platform-capabilities.k8s.enabled=false); ArgoCD / Velero / build-node presence '
      + 'cannot be detected and are reported absent.';
    const svc = setup(caps({ warnings: [notWired] }));
    await svc.load();
    expect(svc.warningFor('argocd')()).toBe(notWired);
    expect(svc.warningFor('velero')()).toBe(notWired);
    expect(svc.warningFor('buildNode')()).toBe(notWired);
    // images is a DB probe, independent of the k8s probe — the k8s notice must NOT flag it.
    expect(svc.warningFor('images')()).toBeNull();
  });

  it('warningFor() matches the per-probe warnings to the right capability', async () => {
    const argocdW = 'ArgoCD presence could not be detected (Kubernetes read failed or was denied); reported absent.';
    const imagesW = 'Generated-images presence could not be read from the images table (database unreachable); reported absent.';
    const svc = setup(caps({ warnings: [argocdW, imagesW] }));
    await svc.load();
    expect(svc.warningFor('argocd')()).toBe(argocdW);
    expect(svc.warningFor('images')()).toBe(imagesW);
    expect(svc.warningFor('velero')()).toBeNull();
  });
});
