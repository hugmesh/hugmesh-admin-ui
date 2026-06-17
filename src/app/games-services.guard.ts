import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Gate the games app-store operator console on a games-services role (mirrors
 * {@link superadminGuard}). Reachable by a games-services ADMIN (catalog-enable +
 * create/run) OR a games-services RUNNER (mod-delegated run/stop) — the derived roles
 * materialized in Casdoor (= ROLE_GAMES_SERVICES ∩ (ROLE_ADMIN ∪ ROLE_MOD) and ∩ ROLE_MOD).
 * The console itself greys-out the create/enable actions for a runner; the BFF
 * @PreAuthorize is the real gate. A caller with neither role is sent to /login.
 */
export const gamesServicesGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isGamesServicesAdmin() || session.isGamesServicesRunner()) return true;
  return router.parseUrl('/login');
};
