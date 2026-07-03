import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guard — allows activation only when the session carries the Casdoor `admin` role
 * (ROLE_ADMIN or higher in the Snapdragon role hierarchy).
 *
 * This is a **presentation-only** check. The BFF enforces `@PreAuthorize("hasRole('ADMIN')")` on
 * every `/bff/admin/**` endpoint, so even if this guard were bypassed the server remains
 * authoritative. The client guard simply avoids loading the admin bundle for a non-admin.
 *
 * All admin routes in {@link ADMIN_ROUTES} are mounted behind this guard by the host shell.
 * A non-admin user who holds a valid session is redirected to `/login` (the session is valid;
 * the role is insufficient).
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
