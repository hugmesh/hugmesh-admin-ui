import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guard — allows activation only when the session carries the Casdoor `superadmin` role
 * (the apex of the Snapdragon role hierarchy: SUPERADMIN > ADMIN > MOD > USER).
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
 * @returns `true` to activate, or a `UrlTree` redirect to `/login` when the role is absent.
 * @see {@link adminGuard} — the lower-tier guard for ROLE_ADMIN routes.
 */
export const superadminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isSuperadmin()) return true;
  return router.parseUrl('/login');
};
