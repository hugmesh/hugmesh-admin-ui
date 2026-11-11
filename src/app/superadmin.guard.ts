import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { refuseNavigation } from './guard-refusal';
import { SessionService } from './session.service';

/**
 * Route guard — allows activation only when the session carries the Casdoor `superadmin` role
 * (the apex of the HugMesh role hierarchy: SUPERADMIN > ADMIN > MOD > USER).
 *
 * Applied to routes whose consequences are cross-domain or irreversible:
 * - `/admin/device-licenses` — mutates the cross-domain device-ownership and SSH-operate-license registry.
 * - `/admin/device-pending` — assigns a headscale-enrolled node into the registry.
 * - `/admin/superadmin/domains` — the multi-tenancy domain_registry brand list.
 * - `/admin/egress-vpn` — imports WireGuard/OpenVPN configs nodes use for public egress.
 * - `/admin/superadmin/anubis` — PoW challenge sidecar read-only metrics view.
 *
 * This is **presentation-only** — the BFF enforces `@PreAuthorize("hasRole('SUPERADMIN')")` on
 * every `/bff/superadmin/**` endpoint as the authoritative gate.
 *
 * @returns `true` to activate; otherwise {@link refuseNavigation}'s redirect: `/login` when signed
 *   out, the host's `/home?denied=<url>` notice when signed in without `superadmin` (e.g. a plain
 *   admin).
 * @see {@link adminGuard} — the lower-tier admin/superadmin guard, wired on `mesh-tokens` only
 *   (the plain ROLE_ADMIN routes are gated only by the host's `/admin` guard — see its TODO).
 */
export const superadminGuard: CanActivateFn = (_route, state) => {
  if (inject(SessionService).isSuperadmin()) return true;
  return refuseNavigation(state);
};
