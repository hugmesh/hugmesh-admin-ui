import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, RouteRule } from './bff.service';

/**
 * Admin "Gateway access" view (ROLE_ADMIN only, route-guarded). Controls, per
 * gateway, which Casdoor roles/users may reach which URL patterns from OUTSIDE
 * the gateway. The admin-api persists rules in Postgres (gateway_route_access);
 * each gateway Cassandra-caches them and denies external access unless the
 * caller's Casdoor roles match. No random app URLs — just role-based locking of
 * the known services. Roles are owned by Casdoor.
 */
@Component({
  selector: 'snap-route-access',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './route-access.component.html',
})
export class RouteAccessComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly gateways = ['snapdragon-pki-gateway', 'snapdragon-be-gateway', 'snapdragon-fe-gateway'];
  readonly rules = signal<RouteRule[]>([]);
  gateway = 'snapdragon-be-gateway';
  urlPattern = '';
  role = 'ROLE_USER';
  allow = true;

  async ngOnInit(): Promise<void> { this.rules.set(await this.bff.routeAccess()); }
  async add(): Promise<void> {
    if (!this.urlPattern.trim() || !this.role.trim()) return;
    this.rules.set(await this.bff.addRouteRule({
      gateway: this.gateway, url_pattern: this.urlPattern.trim(), role: this.role.trim(), allow: this.allow,
    }));
    this.urlPattern = '';
  }
  async remove(id: string): Promise<void> { this.rules.set(await this.bff.removeRouteRule(id)); }
}
