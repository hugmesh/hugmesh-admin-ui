import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sets withCredentials so the HttpOnly bff_ cookie rides the request', () => {
    http.get('/bff/admin/anything').subscribe();
    const req = httpMock.expectOne('/bff/admin/anything');
    expect(req.request.withCredentials).toBeTrue();
    req.flush({});
  });

  it('never attaches an Authorization header (no browser-held bearer)', () => {
    http.get('/bff/admin/anything').subscribe();
    const req = httpMock.expectOne('/bff/admin/anything');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });
});
