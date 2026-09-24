import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guard — allows activation only when the session's `roles` include the literal Casdoor
 * `admin` role (ROLE_ADMIN). It is NOT hierarchy-aware: a session carrying `superadmin` without
 * `admin` fails it (the host shell's `/admin` gate uses the same literal predicate).
 *
 * This is a **presentation-only** check. The BFF enforces `@PreAuthorize("hasRole('ADMIN')")` on
 * every `/bff/admin/**` endpoint, so even if this guard were bypassed the server remains
 * authoritative. What a guard on an ADMIN_ROUTES child could buy is that a refused caller never
 * ACTIVATES that console (no component, so none of its `ngOnInit` BFF calls fire). It could NOT
 * keep the admin bundle from loading: `ADMIN_ROUTES` imports every component statically, so that
 * code is already fetched by the time any child-route guard runs.
 *
 * Any caller that fails the check — anonymous, or signed in without `admin` — is redirected to
 * `/login`, the same destination as this repo's other guards. The host shell's role guards
 * (hugmesh-host-shell `guards/role-guard.factory.ts`) deliberately split those cases: only the
 * anonymous caller goes to `/login`, a signed-in caller without the role goes to
 * `/home?denied=<url>` — sending the latter to the sign-in page was an operator-reported defect
 * there (2026-08-14).
 *
 * TODO(admin-guard): NOT WIRED — no `ADMIN_ROUTES` entry lists this guard (pinned by
 * `admin.routes.spec.ts`), so today it is exercised only by `admin.guard.spec.ts`. The landing
 * and every plain console are gated client-side only by the host shell's own `adminGuard` on its
 * `/admin` parent route (the federation exposes only `./routes`, so neither app can import the
 * other's guard), with the BFF as the authority. Wiring THIS guard onto those routes was
 * evaluated and backed out, because as written it is not safe there:
 *   - It reads this remote's `SessionService`, i.e. only the `hug.session` localStorage mirror.
 *     The host's SessionService re-hydrates from `GET /bff/session` and by design never writes
 *     that mirror, so the two disagree after a mid-session role grant (a flow the host supports
 *     on purpose — hugmesh-host-shell `e2e/features/role-change-midsession.feature`) and for a
 *     cookie-only session with no mirror (which the host's hydrate also supports). The host
 *     would admit such an admin to `/admin` (its `menu-admin` entry is shown off the same
 *     hydrated roles) and this guard would then send them to `/login` — the landing included.
 *   - The standalone dev shell (`app.routes.ts`, `npm start`) mounts ADMIN_ROUTES bare, has no
 *     `/login` route and nothing that writes `hug.session`, so `/` would end in an
 *     unmatched-route navigation error instead of rendering.
 * Decision needed from the owner — one of:
 *   (a) make this remote's SessionService hydrate from `GET /bff/session` itself (as the host
 *       shell's does), and send a signed-in caller without the role to the host's
 *       `/home?denied=<url>` instead of `/login`; only then wire it on the plain routes (never
 *       stacked onto the superadmin/fleet/games/workload routes, whose audiences it would
 *       narrow to `admin`-holders), plus a dev-shell `/login` stub or seeding instructions;
 *   (b) accept the stale-mirror and dev-shell regressions knowingly and wire it as-is; or
 *   (c) delete it and keep the host's `/admin` gate as the only client-side check.
 * The superadmin/fleet/games-services/workload guards take their role check from the same
 * mirror and so already have the stale-mirror exposure on their own routes; that is
 * pre-existing and is not changed here. None of the above has been reproduced on a live
 * stack — it is reasoned from the hugmesh-host-shell and admin-ui code at the time of writing.
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
