import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guard — allows activation only when the session's `roles` include the literal Casdoor
 * `admin` role (ROLE_ADMIN). It is NOT hierarchy-aware: a session carrying `superadmin` without
 * `admin` fails it, exactly as it fails the host shell's `/admin` gate (same predicate).
 *
 * This is the BASELINE guard of {@link ADMIN_ROUTES}: every route that has no stricter or
 * differently-scoped guard of its own carries exactly `canActivate: [adminGuard]` (the full
 * path→guard map is pinned by `admin.routes.spec.ts`). It is deliberately NOT stacked onto the
 * superadmin/fleet/games-services/workload routes — see the GUARD POLICY note on
 * {@link ADMIN_ROUTES} for why stacking would narrow those audiences.
 *
 * Relationship to the host shell: hugmesh-host-shell guards its `/admin` parent route with its
 * own `adminGuard` over the SAME predicate, and Angular runs the parent's `canActivate` first.
 * So under the host this is a second check of an identical rule; its independent value is for
 * the routes when they run without that host guard (the standalone `ng serve admin` dev shell,
 * `app.routes.ts`). Neither app can import the other's guard (the federation exposes only
 * `./routes`), and each holds its OWN `SessionService` over different sources: this remote's
 * reads only the `hug.session` localStorage mirror, the host's is also re-hydrated from
 * `GET /bff/session` without writing the mirror back. When those disagree (a role granted since
 * login-ui last wrote the mirror) this guard can send an admin the host just admitted to
 * `/login`, where login-ui re-reads `/bff/session` and rewrites the mirror. That path is
 * reasoned from the three repos' code, not observed on a live stack.
 *
 * This is a **presentation-only** check. The BFF enforces `@PreAuthorize("hasRole('ADMIN')")` on
 * every `/bff/admin/**` endpoint, so even if this guard were bypassed the server remains
 * authoritative. What the guard buys is that a non-admin never ACTIVATES an admin console (no
 * component, so none of its `ngOnInit` BFF calls fire). It does NOT keep the admin bundle from
 * loading: `ADMIN_ROUTES` imports every component statically, so that code is already fetched by
 * the time any of these child-route guards runs.
 *
 * Any caller that fails the check — anonymous, or signed in without `admin` — is redirected to
 * `/login`, the same destination as the sibling guards in this repo (and hugmesh-mod-ui's
 * `modGuard`). The host shell's own role guards distinguish the two cases (signed in but
 * role-less goes to `/home?denied=…`); under the host a signed-in non-admin is turned away there
 * before reaching this guard, so this `/login` redirect only fires under the host in the
 * mirror-staleness case above. The standalone dev shell has no `/login` route, so there the
 * redirect ends in an unmatched-route navigation error — as the superadmin-guarded routes'
 * redirects already did.
 *
 * @returns `true` to activate, or a `UrlTree` redirect to `/login` on insufficient role.
 * @see {@link superadminGuard} — stricter guard for ROLE_SUPERADMIN-only routes.
 * @see {@link gamesServicesGuard} — derived-role guard for the games app-store console.
 */
export const adminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isAdmin()) return true;
  return router.parseUrl('/login');
};
