import { inject } from '@angular/core';
import { Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Where a SIGNED-IN caller without the role is sent: the host shell's denied notice. This is the
 * host's own `DENIED_PATH` (hugmesh-host-shell `guards/role-guard.factory.ts`), copied rather than
 * imported because federation exposes only `./routes` between the two apps.
 */
export const DENIED_PATH = '/home';

/**
 * The redirect every route guard in this remote returns when it refuses a navigation. It mirrors
 * the host shell's `roleGuard` contract, which keeps TWO failures apart:
 *
 *   NOT SIGNED IN      -> `/login`. There is a credential to supply.
 *   SIGNED IN, no role -> `/home?denied=<attempted url>`. The host's `/home` renders its denied
 *                         notice and names the refused console from `?denied=`.
 *
 * Sending the second case to `/login` was the defect this replaces (GUI retest 2026-11-11): a
 * signed-in admin opening a superadmin console got the "Sign in to hugmesh.net" form under a
 * header that still showed them signed in, which reads as having been logged out. The host
 * shell fixed the same defect in its own guards on 2026-08-14.
 *
 * "Signed in" is read from this remote's {@link SessionService}, i.e. the `hug.session` mirror the
 * login remote writes. A host session with NO mirror (cookie-only) therefore still lands on
 * `/login`, as every refusal did before; see TODO(admin-guard) in `admin.guard.ts`.
 *
 * Call it synchronously from inside a guard (it injects), before any `await`.
 *
 * @param state - the guard's `RouterStateSnapshot`; `state.url` is the full attempted URL (under
 *   the host that includes the `/admin` mount prefix and any query), spelled as the host's own
 *   guards spell it.
 * @returns the `UrlTree` to redirect to.
 */
export function refuseNavigation(state: RouterStateSnapshot): UrlTree {
  const session = inject(SessionService);
  const router = inject(Router);
  if (!session.loggedIn()) return router.parseUrl('/login');
  return router.createUrlTree([DENIED_PATH], { queryParams: { denied: state.url } });
}
