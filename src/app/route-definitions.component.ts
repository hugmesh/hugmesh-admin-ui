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
  templateUrl: './route-definitions.component.html',
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
