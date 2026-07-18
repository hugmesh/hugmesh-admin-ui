import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, DomainCapability } from './bff.service';
import { SessionService } from './session.service';

/** The cluster-wide sentinel domain — mirrors admin-bff's
 *  `DomainCapability#GLOBAL_DOMAIN` (a leading space so it can never collide with a real
 *  issuer-derived domain). */
export const GLOBAL_DOMAIN = ' global';

/**
 * Admin "Domain capabilities" console (own repo: snapdragon-admin-ui) — the per-domain
 * CAPABILITY GATE over the admin-bff `domain_capability` control plane. First (and so far
 * only) capability: {@link BffService.USER_MESH_DEVICES} — a user may register a mesh
 * radio under their own name only if a SUPERADMIN has GRANTED the capability to their
 * domain AND the domain's ADMIN has ENABLED it (two independent keys), plus a
 * platform-wide kill switch.
 *
 * <p>ONE route, TWO views (same "one component, role-differentiated sections" shape as
 * {@code WorkloadConsoleComponent}'s admin-read-vs-superadmin-control-plane split), driven
 * by the LIST endpoint's own server-side scoping ({@code DomainCapabilityAdminController#list}):
 * <ul>
 *   <li><b>SUPERADMIN</b> — sees every domain's gate row (the BFF returns them all). Renders
 *       a table of domains × the {@code granted} toggle (the SUPERADMIN key) + the
 *       {@code enabled} toggle (settable on any domain's behalf), a free-text "grant a new
 *       domain" mini-form for a domain with no row yet, and the {@code ' global'} sentinel
 *       row surfaced SEPARATELY and clearly labelled as the platform-wide kill switch.</li>
 *   <li><b>ADMIN</b> — the BFF scopes the SAME list endpoint to ONLY their own domain, so
 *       {@link ownRow} is simply the first (non-GLOBAL) row returned — no client-side domain
 *       lookup needed. Renders ONE own-domain enable toggle, disabled with an explanatory
 *       hint whenever the row is absent or {@code granted=false} (a superadmin has not yet
 *       granted the capability), so an admin can never flip a switch that has no effect.</li>
 * </ul>
 * A SUPERADMIN is ALSO an ADMIN in the role hierarchy but this console shows ONLY the
 * superadmin table (the own-domain card is specific to a plain-ADMIN session — a
 * superadmin's "home domain" is a write-attribution concept, not a meaningful settings
 * surface here).
 */
@Component({
  selector: 'snap-domain-capabilities',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './domain-capabilities.component.html',
  styleUrl: './domain-capabilities.component.scss',
})
export class DomainCapabilitiesComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /** True when the session carries ROLE_SUPERADMIN — unlocks the cross-domain table. */
  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  /** The single capability this console manages today. */
  readonly capability = BffService.USER_MESH_DEVICES;

  /** Every gate row visible to the caller (BFF-scoped: all domains for SUPERADMIN, only
   *  the caller's own domain for a scoped ADMIN). */
  readonly rows = signal<DomainCapability[]>([]);
  /** True while the initial load (or a reload after a mutation) is in flight. */
  readonly loading = signal(true);
  /** Error from the last load/mutation, surfaced in a role=alert live region. Empty = none. */
  readonly error = signal('');

  /** Real per-domain rows (the `' global'` sentinel is rendered separately). */
  readonly domainRows = computed(() => this.rows().filter(r => r.domain !== GLOBAL_DOMAIN));
  /** The platform-wide-kill sentinel row. Always present after a successful load (seeded
   *  by the changelog) — null only while loading / on a degraded (failed) load. */
  readonly globalRow = computed(() => this.rows().find(r => r.domain === GLOBAL_DOMAIN) ?? null);
  /** The scoped ADMIN's own-domain row. The BFF already scopes the list to ONLY their
   *  domain for a non-superadmin caller, so the first (non-GLOBAL) row IS their own;
   *  absent means the capability has never been granted to their domain. */
  readonly ownRow = computed(() => this.domainRows()[0] ?? null);

  /** Free-text "grant a new domain" mini-form field (SUPERADMIN only; ngModel-bound). */
  newDomain = '';

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  /** Reload every visible gate row from the BFF. */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set(await this.bff.domainCapabilities());
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * SUPERADMIN: flip the `granted` key for an EXISTING row (`row.domain === ' global'`
   * flips the platform-wide kill).
   *
   * @param row - The gate row whose `granted` flag to toggle.
   */
  async toggleGranted(row: DomainCapability): Promise<void> {
    await this.mutate(() => this.bff.setDomainCapabilityGranted(row.domain, this.capability, !row.granted));
  }

  /**
   * SUPERADMIN: flip the `enabled` key on a domain's behalf (any domain — the BFF permits
   * a superadmin to set this for a domain other than their own).
   *
   * @param row - The gate row whose `enabled` flag to toggle.
   */
  async toggleEnabledForDomain(row: DomainCapability): Promise<void> {
    await this.mutate(() => this.bff.setDomainCapabilityEnabled(row.domain, this.capability, !row.enabled));
  }

  /**
   * SUPERADMIN: grant the capability to a brand-new domain that has no row yet (a plain
   * `PUT .../{domain}/{capability} {granted:true}` upserts the first row for it).
   */
  async grantNewDomain(): Promise<void> {
    const domain = this.newDomain.trim();
    if (!domain) {
      this.error.set('Enter a domain to grant.');
      return;
    }
    // Compare trimmed-vs-trimmed: GLOBAL_DOMAIN's significant leading space cannot survive
    // a free-text input round-trip, so guard on the word itself rather than the sentinel's
    // exact (untypeable) form.
    if (domain === GLOBAL_DOMAIN.trim()) {
      this.error.set("Use the platform-wide kill switch above, not this form, for the global sentinel.");
      return;
    }
    await this.mutate(() => this.bff.setDomainCapabilityGranted(domain, this.capability, true));
    this.newDomain = '';
  }

  /**
   * ADMIN: flip their OWN domain's `enabled` key. A no-op guard mirrors the template's
   * `[disabled]` binding — this never fires while {@link ownRow} is absent or ungranted,
   * so an admin can never flip a switch that would have no server-side effect.
   */
  async toggleOwnEnabled(): Promise<void> {
    const row = this.ownRow();
    if (!row || !row.granted) return;
    await this.mutate(() => this.bff.setDomainCapabilityEnabled(row.domain, this.capability, !row.enabled));
  }

  /** Run a mutation, clearing/settting {@link error} and reloading the row list on success. */
  private async mutate(fn: () => Promise<DomainCapability>): Promise<void> {
    this.error.set('');
    try {
      await fn();
      await this.reload();
    } catch (e) {
      this.error.set(this.message(e));
    }
  }

  /**
   * Extract a human-readable message from an unknown thrown value.
   *
   * @param e - The caught error (any type).
   */
  private message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
