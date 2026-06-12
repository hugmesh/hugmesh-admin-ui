import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/** Gate a route on the Casdoor superadmin role (mirrors adminGuard). The Device
 *  Licenses console mutates the cross-domain device/SSH-license registry, so it
 *  is reachable only by a SUPERADMIN; everyone else is sent to /login. */
export const superadminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isSuperadmin()) return true;
  return router.parseUrl('/login');
};
