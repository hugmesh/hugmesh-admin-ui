import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { SessionService } from './session.service';

/**
 * Attaches the admin BFF JWT as an `Authorization: Bearer` header on every
 * outgoing HttpClient request. This is the HttpClient equivalent of the
 * hand-rolled `Authorization: Bearer ${session.bffToken}` header that the
 * fetch-based services (e.g. {@link ./bff.service.ts BffService}) already set —
 * so the generated ng-openapi-gen clients carry the SAME session token and the
 * BFF authorises identically (defence-in-depth gateway + resource-server +
 * `@PreAuthorize`). Requests made while the session is null (not logged in) are
 * forwarded unmodified — the BFF rejects them with 401.
 *
 * <p>Mirrors snapdragon-user-ui's `authInterceptor` so the org-wide
 * ng-openapi-gen adoption is uniform across remotes.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(SessionService).session()?.bffToken;
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
