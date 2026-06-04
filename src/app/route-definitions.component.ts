import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, RouteDefinition } from './bff.service';

/**
 * Admin "Gateway routes" view (ROLE_ADMIN only, route-guarded). Edits the route
 * DEFINITIONS the gateways serve: each row is a url_registry entry (path_prefix →
 * downstream_uri) that the gateway's UrlRegistryRouteDefinitionLocator turns into
 * a live Spring Cloud Gateway route. Distinct from "Gateway access" (role→URL
 * allow/deny). The BFF persists these in Cassandra (snapdragon_gateway.url_registry,
 * authoritative for route definitions).
 */
@Component({
  selector: 'snap-route-definitions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="snap-route-definitions" data-testid="route-definitions-view">
      <h2>Gateway routes — path → downstream</h2>
      <form (ngSubmit)="add()">
        <input data-testid="rd-prefix" [(ngModel)]="pathPrefix" name="prefix" placeholder="/api/games/" />
        <input data-testid="rd-uri" [(ngModel)]="downstreamUri" name="uri" placeholder="http://svc.ns.svc.cluster.local:8080" />
        <input data-testid="rd-service" [(ngModel)]="serviceName" name="service" placeholder="service (optional)" />
        <input data-testid="rd-role" [(ngModel)]="requiredRole" name="role" placeholder="required role (optional)" />
        <button data-testid="rd-add" type="submit">Add / update</button>
      </form>
      <table data-testid="route-definitions-rows">
        <tr><th>Path prefix</th><th>Downstream URI</th><th>Service</th><th>Required role</th><th></th></tr>
        <tr *ngFor="let d of routes()" [attr.data-route-prefix]="d.pathPrefix">
          <td>{{ d.pathPrefix }}</td><td>{{ d.downstreamUri }}</td>
          <td>{{ d.serviceName }}</td><td>{{ d.requiredRole }}</td>
          <td><button [attr.data-remove]="d.pathPrefix" (click)="remove(d.pathPrefix)">remove</button></td>
        </tr>
      </table>
    </section>
  `,
})
export class RouteDefinitionsComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly routes = signal<RouteDefinition[]>([]);
  pathPrefix = '';
  downstreamUri = '';
  serviceName = '';
  requiredRole = '';

  async ngOnInit(): Promise<void> { this.routes.set(await this.bff.routeDefinitions()); }
  async add(): Promise<void> {
    if (!this.pathPrefix.trim() || !this.downstreamUri.trim()) return;
    this.routes.set(await this.bff.upsertRouteDefinition({
      pathPrefix: this.pathPrefix.trim(),
      downstreamUri: this.downstreamUri.trim(),
      serviceName: this.serviceName.trim() || null,
      requiredRole: this.requiredRole.trim() || null,
    }));
    this.pathPrefix = '';
    this.downstreamUri = '';
  }
  async remove(pathPrefix: string): Promise<void> { this.routes.set(await this.bff.removeRouteDefinition(pathPrefix)); }
}
