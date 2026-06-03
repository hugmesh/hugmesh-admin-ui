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
  template: `
    <section class="snap-route-access" data-testid="route-access-view">
      <h2>Gateway access — role → URL</h2>
      <form (ngSubmit)="add()">
        <select data-testid="ra-gateway" [(ngModel)]="gateway" name="gateway">
          <option *ngFor="let g of gateways" [value]="g">{{ g }}</option>
        </select>
        <input data-testid="ra-pattern" [(ngModel)]="urlPattern" name="pattern" placeholder="/api/admin/**" />
        <input data-testid="ra-role" [(ngModel)]="role" name="role" placeholder="ROLE_ADMIN" />
        <label><input type="checkbox" [(ngModel)]="allow" name="allow" /> allow</label>
        <button data-testid="ra-add" type="submit">Add rule</button>
      </form>
      <table data-testid="route-access-rules">
        <tr><th>Gateway</th><th>URL pattern</th><th>Role</th><th>Allow</th><th></th></tr>
        <tr *ngFor="let r of rules()" [attr.data-rule-id]="r.id">
          <td>{{ r.gateway }}</td><td>{{ r.url_pattern }}</td><td>{{ r.role }}</td>
          <td>{{ r.allow ? 'allow' : 'deny' }}</td>
          <td><button [attr.data-remove]="r.id" (click)="remove(r.id)">remove</button></td>
        </tr>
      </table>
    </section>
  `,
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
