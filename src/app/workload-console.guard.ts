import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BffService } from './bff.service';
import { SessionService } from './session.service';

/**
 * Grant-based guard for the WORKLOAD CONSOLE route. The console is a HIDDEN-tier surface
 * (registered but never auto-surfaced); the host loads it ONLY when this guard passes. The
 * client-side role check is presentation-only — the SERVER is authoritative: the guard
 * confirms a LIVE grant/role via the capability probe (which 404s on deny, no existence
 * leak). An admin without a live grant, or anyone when the feature is dark (generator gate
 * off / DB master flag off / no active grant), gets null from the probe and is bounced.
 *
 * A superadmin still goes through the probe so a globally-disabled (admin_enabled=false +
 * not superadmin DANGEROUS) or suspended session is bounced too — the probe is the single
 * server-confirmed truth.
 */
export const workloadConsoleGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const bff = inject(BffService);
  const router = inject(Router);

  // Presentation-only fast fail: a non-admin/non-superadmin never even probes.
  if (!session.isAdmin() && !session.isSuperadmin()) {
    return router.parseUrl('/login');
  }
  // SERVER-CONFIRMED: a live grant/role yields a 200 capability; deny is 404 -> null.
  const cap = await bff.workloadCapability();
  return cap ? true : router.parseUrl('/admin');
};
