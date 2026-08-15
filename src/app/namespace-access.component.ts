import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService } from './bff.service';
import { UserTypeaheadComponent } from './a11y/user-typeahead.component';

/**
 * Admin "Namespace access" view (own repo: hugmesh-admin-ui). Admin-only
 * (route-guarded). Lets an admin grant registered users access to specific
 * cluster namespaces — which scopes what each user sees in Uptrace/observability
 * and (in production) maps to Casdoor groups + k8s RBAC via the Spring admin API.
 */
@Component({
  selector: 'hug-namespace-access',
  standalone: true,
  imports: [CommonModule, FormsModule, UserTypeaheadComponent],
  templateUrl: './namespace-access.component.html',
  styleUrl: './namespace-access.component.scss',
})
export class NamespaceAccessComponent implements OnInit {
  private readonly bff = inject(BffService);
  user = '';
  namespace = '';
  readonly namespaces = signal<string[]>([]);
  readonly grants = signal<{ user: string; namespaces: string[] }[]>([]);
  /** Inline validation surfaced in a role=alert live region. Empty = valid. */
  readonly userError = signal('');

  async ngOnInit(): Promise<void> { this.load(await this.bff.namespaceAccess()); }
  private load(a: { namespaces: string[]; grants: { user: string; namespaces: string[] }[] }): void {
    this.namespaces.set(a.namespaces); this.grants.set(a.grants);
    if (!this.namespace && a.namespaces.length) this.namespace = a.namespaces[0];
  }
  async grant(): Promise<void> {
    if (!this.user.trim() || !this.namespace) { this.userError.set('Enter a user and pick a namespace.'); return; }
    this.userError.set('');
    this.load(await this.bff.grantNamespace(this.user.trim().toLowerCase(), this.namespace));
    this.user = '';
  }
}
