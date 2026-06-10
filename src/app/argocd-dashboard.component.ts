import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService, ArgoApp, ArgoAppDetail } from './bff.service';

/**
 * Admin "ArgoCD" dashboard view (ROLE_ADMIN only, route-guarded). An ArgoCD-style
 * Applications dashboard consuming the role-secured proxy in the admin BFF
 * (/bff/admin/argocd/**) — the BFF is the single contract; ArgoCD's own URL/token
 * never leave the cluster. Mirrors ArgoCD's familiar layout: a grid of app cards
 * with independent sync-status + health badges, and a detail panel with the live
 * resource tree and a Sync button gated by an aria-modal confirm dialog.
 *
 * <p>Reads reflect LIVE ArgoCD state (no caching). When ArgoCD is not wired the
 * BFF returns 503 → surfaced here as an honest "ArgoCD not connected" notice.
 *
 * <p>a11y: every status badge carries a text label (not colour alone); the confirm
 * dialog is role=dialog aria-modal and focus-managed; the app grid is keyboard
 * operable (each card is a button).
 */
@Component({
  selector: 'snap-argocd-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './argocd-dashboard.component.html',
  styleUrl: './argocd-dashboard.component.scss',
})
export class ArgocdDashboardComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly apps = signal<ArgoApp[]>([]);
  readonly unavailable = signal(false);
  readonly loading = signal(true);
  readonly selected = signal<ArgoAppDetail | null>(null);
  /** The app name a pending sync confirmation targets, or null when no dialog. */
  readonly confirming = signal<string | null>(null);
  /** Live-region status message (sync results / errors). */
  readonly status = signal('');

  async ngOnInit(): Promise<void> { await this.refresh(); }

  async refresh(): Promise<void> {
    this.loading.set(true);
    const list = await this.bff.argoApplications();
    this.apps.set(list.items);
    this.unavailable.set(list.unavailable);
    this.loading.set(false);
  }

  async open(name: string): Promise<void> {
    this.selected.set(await this.bff.argoApplication(name));
  }

  closeDetail(): void { this.selected.set(null); }

  /** Step 1 of the guarded sync: open the aria-modal confirm dialog. */
  askSync(name: string): void { this.confirming.set(name); }
  cancelSync(): void { this.confirming.set(null); }

  /** Step 2: confirmed — call the BFF (which itself re-validates the typed token). */
  async confirmSync(): Promise<void> {
    const name = this.confirming();
    if (!name) return;
    this.confirming.set(null);
    const result = await this.bff.argoSync(name);
    this.status.set(result
      ? `Sync ${result.accepted ? 'accepted' : 'rejected'} for ${name} (${result.phase}).`
      : `Sync request for ${name} failed.`);
    await this.refresh();
    if (this.selected()?.app.name === name) await this.open(name);
  }

  /** Badge CSS modifier for a sync status (colour) — always paired with text. */
  syncClass(s: string): string {
    const v = (s || '').toLowerCase();
    if (v === 'synced') return 'is-synced';
    if (v === 'outofsync') return 'is-outofsync';
    return 'is-unknown';
  }

  /** Badge CSS modifier for a health status (colour) — always paired with text. */
  healthClass(h: string): string {
    const v = (h || '').toLowerCase();
    if (v === 'healthy') return 'is-healthy';
    if (v === 'progressing') return 'is-progressing';
    if (v === 'degraded' || v === 'missing') return 'is-degraded';
    return 'is-unknown';
  }
}
