import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { SessionService, SnapSession } from './session.service';

function session(bffToken: string): SnapSession {
  return {
    id: 'google:admin@gmail.com', label: 'admin@gmail.com', provider: 'google',
    roles: ['admin'], bffToken, registrationComplete: true, matrix: null, mastodon: null,
  };
}

describe('authInterceptor', () => {
  const sessionSig = signal<SnapSession | null>(null);
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionSig.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { session: sessionSig } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('attaches the session bffToken as a Bearer header', () => {
    sessionSig.set(session('tok-1'));
    http.get('/bff/admin/anything').subscribe();
    const req = httpMock.expectOne('/bff/admin/anything');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
    req.flush({});
  });

  it('forwards the request unmodified when there is no session', () => {
    http.get('/bff/admin/anything').subscribe();
    const req = httpMock.expectOne('/bff/admin/anything');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });
});
