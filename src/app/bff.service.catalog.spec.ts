import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BffService, ImageBuildCatalog } from './bff.service';
import { SessionService, SnapSession } from './session.service';

/** Minimal fetch Response stub (mirrors bff.service.spec.ts). */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function adminSession(): SnapSession {
  return {
    id: 'google:admin@gmail.com',
    label: 'admin@gmail.com',
    provider: 'google',
    roles: ['admin'],
    registrationComplete: true,
  };
}

function fixture(): ImageBuildCatalog {
  return {
    packages: {
      adhoc_adds: { tor: { atoms: ['net-vpn/tor'], label: 'Tor onion service' } },
      platforms: {
        x86: { packages: { gate: 'base', sections: [{ title: '', atoms: ['app-misc/jq'] }] } },
      },
    },
    images: {
      platform_labels: { x86: 'x86_64 host' },
      role_class: { desktop: ['laptop'], node: ['be'] },
      roles: { cloud: [{ role: 'laptop', label: 'Laptop', image_class: 'desktop', platforms: [{ platform: 'x86', axes: { desktop: ['thin', 'full'] } }] }] },
    },
  };
}

describe('BffService.imageBuildCatalog', () => {
  let service: BffService;
  let fetchSpy: jasmine.Spy;
  const sessionSig = signal<SnapSession | null>(null);

  beforeEach(() => {
    sessionSig.set(adminSession());
    TestBed.configureTestingModule({
      providers: [BffService, { provide: SessionService, useValue: { session: sessionSig } }],
    });
    service = TestBed.inject(BffService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  function lastUrl(): string {
    return String(fetchSpy.calls.mostRecent().args[0]);
  }
  function lastInit(): RequestInit {
    return (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit;
  }

  it('GETs the catalog endpoint with the HttpOnly cookie and NO Authorization header', async () => {
    fetchSpy.and.resolveTo(jsonResponse(fixture()));
    await service.imageBuildCatalog();
    expect(lastUrl()).toContain('/bff/admin/image-builds/catalog');
    expect(lastInit().credentials).toBe('include');
    expect((lastInit().headers as Record<string, string>)?.['authorization']).toBeUndefined();
  });

  it('returns the parsed { packages, images } pass-through payload', async () => {
    const body = fixture();
    fetchSpy.and.resolveTo(jsonResponse(body));
    const result = await service.imageBuildCatalog();
    expect(result).toEqual(body);
    // The load-bearing shapes the modal + wizard read survive verbatim.
    expect(result!.packages.platforms['x86']['packages'].gate).toBe('base');
    expect(result!.packages.adhoc_adds['tor'].atoms).toEqual(['net-vpn/tor']);
    expect(result!.images.role_class.desktop).toContain('laptop');
    expect(result!.images.roles['cloud'][0].platforms[0].axes['desktop']).toEqual(['thin', 'full']);
  });

  it('returns null (not throw) when the catalog is unavailable / denied', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 503 }));
    expect(await service.imageBuildCatalog()).toBeNull();
  });
});
