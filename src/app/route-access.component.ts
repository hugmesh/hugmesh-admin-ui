import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, RouteRule } from './bff.service';

/**
 * The DEPLOYED gateway instance names — the `gateway` column value a rule must
 * carry to be read by a running gateway.
 *
 * SOURCE OF TRUTH (hugmesh-generator, read-only from here):
 *   - specs/cluster/apps/20-gateway-pki.yaml         → helm values `instance.name`
 *   - specs/cluster/apps/20-gateway-be.yaml          → helm values `instance.name`
 *   - specs/cluster/apps/20-gateway-fe.yaml          → helm values `instance.name`
 *   - specs/cluster/apps/22-gateway-superadmin.yaml  → helm values `instance.name`
 *   - specs/cluster/manifests/route-access/initdb/20-schema.sql → the seeded rows
 *     use exactly these four literals.
 *
 * This list is NOT cosmetic. Each gateway loads only the rows whose `gateway`
 * equals its OWN instance name, so a rule written against any other string is
 * persisted, listed, mirrored to Cassandra — and silently never enforced. That is
 * precisely what shipped: the console offered `snapdragon-*-gateway`, a name no
 * deployed instance has carried since the HugMesh rebrand, so every rule this
 * console wrote (including every `mfa_required` floor) was inert.
 *
 * admin-bff does NOT validate the name (RouteRuleRequest only bounds it @NotBlank
 * @Size(max=255)), so this console is the only place the vocabulary is enforced.
 * Keep it in lockstep with the generator; route-access.gateway-vocabulary.spec.ts
 * fails the build if it drifts.
 */
export const DEPLOYED_GATEWAYS = [
  'hugmesh-pki-gateway',
  'hugmesh-be-gateway',
  'hugmesh-fe-gateway',
  'hugmesh-superadmin-gateway',
] as const;

export type DeployedGateway = (typeof DEPLOYED_GATEWAYS)[number];

/** The instance most admin rules target (the public API front door). */
export const DEFAULT_GATEWAY: DeployedGateway = 'hugmesh-be-gateway';

/**
 * Admin "Gateway access" view (ROLE_ADMIN only, route-guarded). Controls, per
 * gateway, which Casdoor roles/users may reach which URL patterns from OUTSIDE
 * the gateway. The admin-api persists rules in Postgres (gateway_route_access);
 * each gateway Cassandra-caches them and denies external access unless the
 * caller's Casdoor roles match. No random app URLs — just role-based locking of
 * the known services. Roles are owned by Casdoor.
 */
@Component({
  selector: 'hug-route-access',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './route-access.component.html',
  styleUrl: './route-access.component.scss',
})
export class RouteAccessComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly gateways: readonly string[] = DEPLOYED_GATEWAYS;
  readonly rules = signal<RouteRule[]>([]);
  gateway: string = DEFAULT_GATEWAY;
  urlPattern = '';
  role = 'ROLE_USER';
  allow = true;
  /** Per-route MFA floor (gateway-enforced; the BFF only persists the flag).
   *  Defaults false like the DB column, and like `allow` it is edited only
   *  through this add form — a seeded row is "edited" by remove + re-add. */
  mfaRequired = false;
  /** Inline validation surfaced in a role=alert live region. Empty = valid. */
  readonly formError = signal('');

  async ngOnInit(): Promise<void> { this.rules.set(await this.bff.routeAccess()); }
  async add(): Promise<void> {
    if (!this.urlPattern.trim() || !this.role.trim()) { this.formError.set('A URL pattern and a role are required.'); return; }
    // WRITE-SIDE vocabulary gate. The <select> can only offer `gateways`, but the
    // bound model is a plain string, so any non-select writer (a prefill, a
    // restored form state, a future free-text field) could aim a rule at a
    // gateway that does not exist — which admin-bff would happily persist and no
    // gateway would ever read. Fail loudly instead of writing an inert rule.
    // NOTE: this checks the value against the SHIPPED list; it is not what keeps
    // the list itself honest — route-access.gateway-vocabulary.spec.ts is.
    if (!this.gateways.includes(this.gateway)) {
      this.formError.set(
        `Unknown gateway "${this.gateway}". A rule must name a deployed gateway ` +
        `(${this.gateways.join(', ')}) or it is never enforced.`);
      return;
    }
    this.formError.set('');
    this.rules.set(await this.bff.addRouteRule({
      gateway: this.gateway, url_pattern: this.urlPattern.trim(), role: this.role.trim(), allow: this.allow,
      mfa_required: this.mfaRequired,
    }));
    this.urlPattern = '';
  }
  async remove(id: string): Promise<void> { this.rules.set(await this.bff.removeRouteRule(id)); }
}
