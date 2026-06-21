import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, CreateDomainRequest, DomainResponse } from './bff.service';

/**
 * Superadmin "Domains" console (own repo: snapdragon-admin-ui) — the multi-tenancy PR9
 * SUPERADMIN surface over {@code domain_registry}, the RUNTIME source of truth for which
 * brands/domains exist in the cluster (the twin of the build-time brands/domains.conf the
 * generator bakes in). SUPERADMIN-only (route-guarded by {@link superadminGuard}); a
 * non-superadmin is bounced to /login.
 *
 * <p>The view LISTS every registered domain (cluster_domain, brand, org, status/enabled,
 * mesh_tag) and lets a superadmin REGISTER a new one (cluster_domain + the brand
 * descriptors brand / org / ca_ref / ns_prefix / casdoor_org / mesh_tag). Every endpoint
 * is also {@code hasRole('SUPERADMIN')} at the BFF (DomainRegistryController); this console
 * mirrors that gate as defence-in-depth. A duplicate cluster_domain is surfaced as the
 * BFF's clean 409 in a role=alert live region. There is NO hard delete (a domain is
 * soft-disabled via PUT enabled:false — not wired in this MVP create+list surface).
 */
@Component({
  selector: 'snap-superadmin-domains',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './superadmin-domains.component.html',
  styleUrl: './superadmin-domains.component.scss',
})
export class SuperadminDomainsComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly domains = signal<DomainResponse[]>([]);

  /** Register-domain form state (mirrors the CreateDomainRequest DTO field names). */
  clusterDomain = '';
  brand = '';
  org = '';
  caRef = '';
  nsPrefix = '';
  casdoorOrg = '';
  meshTag = '';

  /** Inline validation / server error surfaced in a role=alert live region. Empty = none. */
  readonly formError = signal('');

  async ngOnInit(): Promise<void> {
    this.domains.set(await this.bff.listDomains());
  }

  /**
   * Whether a domain is fully PROVISIONED — its CA is issued AND its ArgoCD
   * ApplicationSet is registered (band-190 provisioning status, admin-bff #118).
   * These fields DEFAULT false and only flip once the generator domain-reconcile
   * effector runs, so at rest every freshly-registered domain reads false here and
   * the console honestly shows the degraded "not yet provisioned" chip (the
   * platform-capability-gating mandate). Pure presentational — no new BFF call.
   */
  isProvisioned(d: DomainResponse): boolean {
    return !!(d.caProvisioned && d.appsetRegistered);
  }

  async register(): Promise<void> {
    const clusterDomain = this.clusterDomain.trim().toLowerCase();
    if (!clusterDomain) {
      this.formError.set('Enter a cluster domain (the brand’s base domain) to register.');
      return;
    }
    this.formError.set('');
    const req: CreateDomainRequest = {
      clusterDomain,
      brand: this.brand.trim() || null,
      org: this.org.trim() || null,
      caRef: this.caRef.trim() || null,
      nsPrefix: this.nsPrefix.trim() || null,
      casdoorOrg: this.casdoorOrg.trim() || null,
      meshTag: this.meshTag.trim() || null,
    };
    try {
      const created = await this.bff.createDomain(req);
      // Optimistic prepend; a full re-list would also work but the BFF returns the row.
      this.domains.set([created, ...this.domains()]);
      this.clusterDomain = '';
      this.brand = '';
      this.org = '';
      this.caRef = '';
      this.nsPrefix = '';
      this.casdoorOrg = '';
      this.meshTag = '';
    } catch (e) {
      // A duplicate cluster_domain is the BFF's clean 409 {error}; surface it verbatim.
      this.formError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
