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
});
