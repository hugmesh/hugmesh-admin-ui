import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService } from './bff.service';

/**
 * Admin "Namespace access" view (own repo: snapdragon-admin-ui). Admin-only
 * (route-guarded). Lets an admin grant registered users access to specific
 * cluster namespaces — which scopes what each user sees in Uptrace/observability
 * and (in production) maps to Casdoor groups + k8s RBAC via the Spring admin API.
 */
@Component({
  selector: 'snap-namespace-access',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="snap-ns" data-testid="ns-view">
      <h2>Namespace access</h2>
      <form (ngSubmit)="grant()">
        <input data-testid="ns-user" [(ngModel)]="user" name="user" placeholder="user (email/discord)" />
        <select data-testid="ns-select" [(ngModel)]="namespace" name="namespace">
          <option *ngFor="let n of namespaces()" [value]="n">{{ n }}</option>
        </select>
        <button data-testid="ns-grant" type="submit">Grant</button>
      </form>
      <ul data-testid="ns-grants">
        <li *ngFor="let g of grants()" [attr.data-user]="g.user">
          <strong>{{ g.user }}</strong>: {{ g.namespaces.join(', ') }}
        </li>
      </ul>
    </section>
  `,
})
export class NamespaceAccessComponent implements OnInit {
  private readonly bff = inject(BffService);
  user = '';
  namespace = '';
  readonly namespaces = signal<string[]>([]);
  readonly grants = signal<{ user: string; namespaces: string[] }[]>([]);

  async ngOnInit(): Promise<void> { this.load(await this.bff.namespaceAccess()); }
  private load(a: { namespaces: string[]; grants: { user: string; namespaces: string[] }[] }): void {
    this.namespaces.set(a.namespaces); this.grants.set(a.grants);
    if (!this.namespace && a.namespaces.length) this.namespace = a.namespaces[0];
  }
  async grant(): Promise<void> {
    if (!this.user.trim() || !this.namespace) return;
    this.load(await this.bff.grantNamespace(this.user.trim().toLowerCase(), this.namespace));
    this.user = '';
  }
}
