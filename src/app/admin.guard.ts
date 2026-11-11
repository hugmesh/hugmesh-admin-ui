import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { refuseNavigation } from './guard-refusal';
import { SessionService } from './session.service';

/**
 * Route guard — allows activation when the session's `roles` include the Casdoor `admin` role
 * (ROLE_ADMIN) OR `superadmin` (ROLE_SUPERADMIN). The second arm matches admin-bff, whose
 * RoleHierarchy declares `ROLE_SUPERADMIN > ROLE_ADMIN`, so every `hasRole('ADMIN')` endpoint behind
 * the guarded console also serves a superadmin-ONLY session. Checking the literal `admin` alone (as
 * this guard did until 2026-11-11) refused a pure superadmin a console the BFF would serve them.
 * The host shell's own `/admin` gate must agree for a superadmin-only session to reach this guard
 * at all; that is the host half of the same fix (GUI-01).
 *
 * This is a **presentation-only** check. The BFF enforces `@PreAuthorize("hasRole('ADMIN')")` on
 * every `/bff/admin/**` endpoint, so even if this guard were bypassed the server remains
 * authoritative. What a guard on an ADMIN_ROUTES child could buy is that a refused caller never
 * ACTIVATES that console (no component, so none of its `ngOnInit` BFF calls fire). It could NOT
 * keep the admin bundle from loading: `ADMIN_ROUTES` imports every component statically, so that
 * code is already fetched by the time any child-route guard runs.
 *
 * A refused caller gets {@link refuseNavigation}'s redirect, the same split the host shell's role
 * guards make (hugmesh-host-shell `guards/role-guard.factory.ts`): an anonymous caller goes to
 * `/login`, a signed-in caller without the role goes to `/home?denied=<url>`. Sending the latter to
 * the sign-in page read as a logout; the host fixed it on 2026-08-14 and this remote on 2026-11-11.
 *
 * TODO(admin-guard): WIRED ON ONE ROUTE ONLY — `mesh-tokens` (the mesh-token issuing console)
 * adopts option (b) below knowingly, for that credential-minting route alone; no other
 * `ADMIN_ROUTES` entry lists this guard (both pinned by `admin.routes.spec.ts`). The landing
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
 *     hydrated roles) and this guard would then refuse them: to `/home?denied=` with a stale
 *     mirror, to `/login` with none — the landing included.
 *   - The standalone dev shell (`app.routes.ts`, `npm start`) mounts ADMIN_ROUTES bare, has no
 *     `/login` or `/home` route and nothing that writes `hug.session`, so `/` would end in an
 *     unmatched-route navigation error instead of rendering.
 * Decision needed from the owner — one of:
 *   (a) make this remote's SessionService hydrate from `GET /bff/session` itself (as the host
 *       shell's does); only then wire it on the plain routes (never stacked onto the
 *       superadmin/fleet/games/workload routes, whose audiences it would narrow to
 *       admin/superadmin-holders), plus a dev-shell `/login` stub or seeding instructions. The
 *       other half of the original (a), sending a signed-in caller without the role to the
 *       host's `/home?denied=<url>` instead of `/login`, is done (2026-11-11, every guard here);
 *   (b) accept the stale-mirror and dev-shell regressions knowingly and wire it as-is; or
 *   (c) delete it and keep the host's `/admin` gate as the only client-side check.
 * The superadmin/fleet/games-services/workload guards take their role check from the same
 * mirror and so already have the stale-mirror exposure on their own routes; that is
 * pre-existing and is not changed here. None of the above has been reproduced on a live
 * stack — it is reasoned from the hugmesh-host-shell and admin-ui code at the time of writing.
 *
 * @returns `true` to activate, or {@link refuseNavigation}'s `UrlTree` on insufficient role.
 * @see {@link superadminGuard} — stricter guard for ROLE_SUPERADMIN-only routes.
 * @see {@link gamesServicesGuard} — derived-role guard for the games app-store console.
 */
export const adminGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  if (session.isAdmin() || session.isSuperadmin()) return true;
  return refuseNavigation(state);
};
