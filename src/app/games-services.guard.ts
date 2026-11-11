import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { refuseNavigation } from './guard-refusal';
import { SessionService } from './session.service';

/**
 * Gate the games app-store operator console on a games-services role (mirrors
 * {@link superadminGuard}). Reachable by a games-services ADMIN (catalog-enable +
 * create/run) OR a games-services RUNNER (mod-delegated run/stop) — the derived roles
 * materialized in Casdoor (= ROLE_GAMES_SERVICES ∩ (ROLE_ADMIN ∪ ROLE_MOD) and ∩ ROLE_MOD).
 * The console itself greys-out the create/enable actions for a runner; the BFF
 * @PreAuthorize is the real gate. A caller with neither role is refused via
 * {@link refuseNavigation}: `/login` when signed out, the host's `/home?denied=<url>` notice when
 * signed in (a plain `admin`, or a `games_admin` without the games-services role).
 */
export const gamesServicesGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  if (session.isGamesServicesAdmin() || session.isGamesServicesRunner()) return true;
  return refuseNavigation(state);
};
