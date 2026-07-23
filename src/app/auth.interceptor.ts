import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Sends the HttpOnly `bff_` cookie on every outgoing HttpClient request by
 * setting `withCredentials: true`. This is the HttpClient equivalent of the
 * `credentials: 'include'` the fetch-based services (e.g. {@link ./bff.service.ts
 * BffService}) set — so the generated ng-openapi-gen clients ride the SAME
 * same-origin cookie and the gateway's BffCookieToBearerWebFilter turns it into
 * the bearer server-side (the browser never holds an admin bearer). The BFF then
 * authorises identically (defence-in-depth gateway + resource-server +
 * `@PreAuthorize`). An unauthenticated request (no cookie) is rejected with 401.
 *
 * <p>Mirrors hugmesh-user-ui's `authInterceptor` so the org-wide
 * ng-openapi-gen adoption is uniform across remotes.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
