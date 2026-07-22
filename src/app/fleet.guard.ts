import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guard for the FLEET-OWNER surface (`/admin/my-fleet` → {@link MyFleetComponent}) — the
 * PUBLIC `/bff/admin/phone-fleet/**` plane where a non-superadmin fleet owner manages ONLY their
 * own phones. Admits any session with the fleet capability: a dedicated `fleet_admin` role OR the
 * broader `admin`/`superadmin` roles (see {@link SessionService.isFleetAdmin}), mirroring the
 * admin-bff's coarse `hasAnyRole('FLEET_ADMIN','ADMIN','SUPERADMIN')` gate.
 *
 * This is **presentation-only** — the BFF is the authoritative gate: every
 * `/bff/admin/phone-fleet/**` endpoint re-enforces the role AND the per-subject ENTITLEMENT and
 * scopes every read/mutation to `physical_owner = caller AND owner_domain = caller-domain`. A
 * caller without the fleet capability is redirected to `/login`.
 *
 * @returns `true` to activate, or a `UrlTree` redirect to `/login` when the capability is absent.
 * @see {@link adminGuard} / {@link superadminGuard} — the sibling role guards.
 */
export const fleetAdminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isFleetAdmin()) return true;
  return router.parseUrl('/login');
};
