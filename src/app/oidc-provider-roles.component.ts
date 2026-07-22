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
 * The registration-flow hook (hugmesh-actions) will read these mappings and
 * assign roles at first login once wired (see feat/oidc-registration-role-hook).
 */
@Component({
  selector: 'hug-oidc-provider-roles',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './oidc-provider-roles.component.html',
  styleUrl: './oidc-provider-roles.component.scss',
})
export class OidcProviderRolesComponent implements OnInit {
  private readonly bff = inject(BffService);

  /** The current OIDC provider → role mappings returned by `GET /bff/admin/oidc-provider-roles`. */
  readonly providers = signal<OidcProviderMapping[]>([]);
  /** Inline validation / server error surfaced in a `role=alert` live region. Empty = no error. */
  readonly formError = signal('');
  /** True while the save call is in flight (disables the save button). */
  readonly saving = signal(false);

  /**
   * The available role names for the multi-select picker. `superadmin` is intentionally
   * excluded — it cannot be auto-assigned via OIDC registration (it must be manually granted
   * by an existing superadmin to prevent privilege escalation via provider compromise).
   */
  readonly availableRoles = ['user', 'mod', 'admin', 'tube', 'owncast'];

  /** The OIDC provider name being configured (ngModel-bound plain property). */
  provider = '';
  /**
   * The roles currently checked in the multi-select (ngModel-managed array).
   * Defaults to `['user']` — the minimum auto-grant at registration.
   */
  selectedRoles: string[] = ['user'];

  async ngOnInit(): Promise<void> {
    // Load the existing provider → role mappings on init.
    this.providers.set(await this.bff.oidcProviderRoles());
  }

  /**
   * Toggle a role's presence in `selectedRoles`. Adds the role when absent;
   * removes it when already selected.
   *
   * @param role - The role name to toggle (e.g. `'mod'`, `'tube'`).
   */
  toggleRole(role: string): void {
    if (this.selectedRoles.includes(role)) {
      this.selectedRoles = this.selectedRoles.filter(r => r !== role);
    } else {
      this.selectedRoles = [...this.selectedRoles, role];
    }
  }

  /**
   * Save the current provider → roles mapping to the BFF (`PUT /bff/admin/oidc-provider-roles/{provider}`).
   * Validates that the provider name is non-empty and follows the lowercase-alphanumeric pattern
   * before sending. Reloads the full list from the BFF after a successful save.
   *
   * @throws BFF error message surfaced into the `formError` signal.
   */
  async save(): Promise<void> {
    const p = this.provider.trim();
    if (!p) { this.formError.set('Provider name is required.'); return; }
    // Enforce lowercase alphanumeric-with-dash/underscore (Casdoor provider name format).
    if (!/^[a-z0-9_-]+$/.test(p)) { this.formError.set('Provider name must be lowercase alphanumeric.'); return; }
    this.formError.set('');
    this.saving.set(true);
    try {
      await this.bff.setOidcProviderRoles(p, this.selectedRoles);
      // Re-fetch the full list (the BFF may merge/update or return the canonical stored form).
      this.providers.set(await this.bff.oidcProviderRoles());
      this.provider = '';
      this.selectedRoles = ['user'];
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Remove a provider → roles mapping (`DELETE /bff/admin/oidc-provider-roles/{provider}`).
   * New users registering via this provider will no longer receive auto-assigned roles.
   * Reloads the list after removal.
   *
   * @param provider - The provider name to remove (e.g. `'google'`).
   */
  async remove(provider: string): Promise<void> {
    await this.bff.clearOidcProviderRoles(provider);
    this.providers.set(await this.bff.oidcProviderRoles());
  }
}
