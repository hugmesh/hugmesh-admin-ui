import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  BACKING_SERVICES_STEP_UP_HEADER,
  BackingServiceApiError,
  BackingServiceMode,
  BackingServiceRow,
  BackingServicesService,
} from './backing-services.service';

/**
 * The MANAGED BACKING-SERVICES console (SUPERADMIN, route-guarded by
 * {@link superadminGuard}). The UI half of the managed/self-hosted axis (cloud-deploy DESIGN
 * I8-DESIGN, Lane M3), over the hugmesh-admin-bff-api `backingservices` surfaces. Cloned from
 * the cloud-backups module (shell + hand-written typed service + typed error + in-module e2e).
 * Mounted at /admin/backing-services.
 *
 * <p>The console renders the CLOSED catalog JOINED with each service's current recorded mode:
 * <ul>
 *   <li><b>Catalog table</b> — id, kind, tier, current mode, endpoint. Self-hosted is the
 *       byte-identical default.</li>
 *   <li><b>Mode edit</b> — for a tier-1/2 service: choose self-hosted | managed, and for
 *       managed a hosted endpoint + a creds-reference (a Vault/ESO path NAME, never bytes) +
 *       a step-up token. Recording is INTENT ONLY (the generator/effector leg converges it).</li>
 *   <li><b>Tier-3 (docs-only)</b> — rendered READ-ONLY with the blocker note: the managed swap
 *       is architecturally blocked and ships as design docs, not a runtime mode change.</li>
 * </ul>
 *
 * <p>Gating: the bff is AUTHORITATIVE (SUPERADMIN-only + step-up on the mutating verb; ships
 * dark). The UI degrades on a 401/403/409/503 — a step-up 403 prompts for a token, a tier-3 409
 * shows the blocker, a dark 503 shows the ships-dark note.
 */
@Component({
  selector: 'snap-backing-services',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './backing-services.component.html',
  styleUrl: './backing-services.scss',
})
export class BackingServicesComponent implements OnInit {
  private readonly api = inject(BackingServicesService);

  readonly loading = signal(false);
  readonly loadError = signal('');
  /** Whether the feature ships dark (reads are live, mode changes 503) — from GET enabled. */
  readonly enabled = signal(true);
  readonly note = signal('');
  readonly services = signal<BackingServiceRow[]>([]);

  // ── mode-edit form (bound to the row being edited) ──
  readonly editing = signal<BackingServiceRow | null>(null);
  readonly mode = signal<BackingServiceMode>('self-hosted');
  readonly endpoint = signal('');
  readonly credsRef = signal('');
  readonly stepUpToken = signal('');
  readonly busy = signal(false);
  readonly touched = signal(false);
  readonly formError = signal('');
  readonly notice = signal('');
  /** True after a step-up-required 403 — the form reveals the step-up token field + prompt. */
  readonly stepUpRequired = signal(false);
  /**
   * The request-header name the server NAMED in its step-up rejection, remembered across the
   * prompt so the retry puts the operator's token on exactly that header — and so the label the
   * operator reads is the server's answer, not a client-side guess that can go stale. Falls back to
   * the compile-time gate constant for an admin-bff that predates the structured signal.
   */
  readonly stepUpRetryHeader = signal<string>(BACKING_SERVICES_STEP_UP_HEADER);

  readonly modes: ReadonlyArray<{ value: BackingServiceMode; label: string }> = [
    { value: 'self-hosted', label: 'Self-hosted (in-mesh, default)' },
    { value: 'managed', label: 'Managed (hosted cloud)' },
  ];

  /** Managed mode needs an endpoint; self-hosted omits it. */
  readonly managed = computed(() => this.mode() === 'managed');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const cat = await this.api.getCatalog();
      this.enabled.set(cat.enabled);
      this.note.set(cat.note ?? '');
      this.services.set(cat.services ?? []);
    } catch (e) {
      this.services.set([]);
      if (e instanceof BackingServiceApiError && (e.isForbidden || e.isUnauthorized)) {
        this.loadError.set('The server denied the backing-services catalog — the superadmin role is required.');
      } else {
        this.loadError.set('Could not load the backing-services catalog. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Begin editing a tier-1/2 row (tier-3 is read-only — never editable). Prefills the form from
   *  the row's current recorded mode. */
  startEdit(row: BackingServiceRow): void {
    if (row.docsOnly) return; // defence-in-depth: tier-3 is read-only
    this.editing.set(row);
    this.mode.set(row.currentMode);
    this.endpoint.set(row.endpoint ?? '');
    this.credsRef.set(row.credsRef ?? '');
    this.stepUpToken.set('');
    this.touched.set(false);
    this.formError.set('');
    this.notice.set('');
    this.stepUpRequired.set(false);
    // Never carry a previous row's advertised flavour into a fresh edit.
    this.stepUpRetryHeader.set(BACKING_SERVICES_STEP_UP_HEADER);
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.formError.set('');
    this.stepUpRequired.set(false);
  }

  endpointInvalid(): boolean {
    return this.touched() && this.managed() && this.endpoint().trim().length === 0;
  }

  canSave(): boolean {
    if (this.busy()) return false;
    if (this.managed() && this.endpoint().trim().length === 0) return false;
    return true;
  }

  async save(): Promise<void> {
    const row = this.editing();
    if (!row) return;
    this.touched.set(true);
    this.formError.set('');
    this.notice.set('');
    if (!this.canSave()) return;
    this.busy.set(true);
    try {
      const recorded = await this.api.setMode(
        row.id,
        {
          mode: this.mode(),
          // endpoint/credsRef only for managed; self-hosted sends none.
          endpoint: this.managed() ? this.endpoint().trim() || null : null,
          credsRef: this.managed() ? this.credsRef().trim() || null : null,
        },
        this.stepUpToken().trim() || undefined,
        this.stepUpRetryHeader(),
      );
      this.notice.set(`Recorded ${row.id} → ${recorded.mode}. ${recorded.note ?? ''}`.trim());
      this.stepUpRequired.set(false);
      this.editing.set(null);
      // Reload so the table reflects the new current mode.
      await this.load();
    } catch (e) {
      this.formError.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown): string {
    if (e instanceof BackingServiceApiError) {
      if (e.isStepUpRequired) {
        // Reveal the step-up field + keep the form open so the operator can supply a token. The
        // retry header comes from the server's own signal when it sent one (structured path); an
        // older admin-bff sends none, so the compile-time constant stays in place.
        this.stepUpRetryHeader.set(e.stepUpRetryHeader ?? BACKING_SERVICES_STEP_UP_HEADER);
        this.stepUpRequired.set(true);
        return 'This change requires step-up re-authentication — enter a step-up token and retry.';
      }
      if (e.isDark) {
        return 'Managed backing-services admin ships dark (app.backing-services.enabled=false) — no mode was recorded.';
      }
      if (e.isDocsOnly) {
        return e.message || 'This service is docs-only — its managed swap is not a runtime mode change.';
      }
      if (e.isForbidden) return 'The server denied the change — the superadmin role is required.';
      if (e.isBadRequest) return e.message || 'The mode request was rejected.';
    }
    return 'Could not record the mode change. Please try again.';
  }
}
