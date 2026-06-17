import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, OidcProviderMapping } from './bff.service';

/**
 * Admin "OIDC Provider Roles" view (ROLE_ADMIN only). Configures which Casdoor
 * roles new users automatically receive when they register via a given OIDC
 * identity provider (Google, GitHub, or a custom OIDC name set up in Casdoor).
 *
 * Scoped to the acting admin's domain — a brand admin only configures mappings for
 * their own brand's providers; SUPERADMIN sees all domains.
 *
 * The registration-flow hook (snapdragon-actions) will read these mappings and
 * assign roles at first login once wired (see feat/oidc-registration-role-hook).
 */
@Component({
  selector: 'snap-oidc-provider-roles',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './oidc-provider-roles.component.html',
  styleUrl: './oidc-provider-roles.component.scss',
})
export class OidcProviderRolesComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly providers = signal<OidcProviderMapping[]>([]);
  readonly formError = signal('');
  readonly saving = signal(false);

  /** Available role names for the multi-select. Superadmin role is excluded
   *  (it cannot be auto-assigned via OIDC — only granted manually). */
  readonly availableRoles = ['user', 'mod', 'admin', 'tube', 'owncast'];

  /** Form fields for adding / editing a provider mapping. */
  provider = '';
  selectedRoles: string[] = ['user'];

  async ngOnInit(): Promise<void> {
    this.providers.set(await this.bff.oidcProviderRoles());
  }

  toggleRole(role: string): void {
    if (this.selectedRoles.includes(role)) {
      this.selectedRoles = this.selectedRoles.filter(r => r !== role);
    } else {
      this.selectedRoles = [...this.selectedRoles, role];
    }
  }

  async save(): Promise<void> {
    const p = this.provider.trim();
    if (!p) { this.formError.set('Provider name is required.'); return; }
    if (!/^[a-z0-9_-]+$/.test(p)) { this.formError.set('Provider name must be lowercase alphanumeric.'); return; }
    this.formError.set('');
    this.saving.set(true);
    try {
      await this.bff.setOidcProviderRoles(p, this.selectedRoles);
      this.providers.set(await this.bff.oidcProviderRoles());
      this.provider = '';
      this.selectedRoles = ['user'];
    } finally {
      this.saving.set(false);
    }
  }

  async remove(provider: string): Promise<void> {
    await this.bff.clearOidcProviderRoles(provider);
    this.providers.set(await this.bff.oidcProviderRoles());
  }
}
