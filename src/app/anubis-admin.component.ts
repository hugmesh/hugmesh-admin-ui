import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService, AnubisStatus, AnubisMetric } from './bff.service';

/**
 * Superadmin "Anubis" console — read-only view of the Anubis proof-of-work challenge
 * sidecar that fronts {@code snapdragon-fe-gateway}. SUPERADMIN-only (both route-guarded
 * by {@code superadminGuard} and enforced at the BFF with {@code hasRole('SUPERADMIN')}).
 *
 * <p>Anubis is configured entirely via environment variables at sidecar startup (difficulty,
 * bypass paths, bot policy). Settings shown here come from the BFF's own config, not from
 * Anubis itself — mutation requires a pod restart via the generator's ArgoCD deployment.
 * The metrics tab proxies the Anubis Prometheus metrics endpoint and refreshes every 30 s
 * while the auto-refresh toggle is on.
 *
 * <p>When {@code enabled=false} on the BFF (the default until the sidecar is deployed),
 * the view shows a clear "not configured" banner instead of connection errors.
 */
@Component({
  selector: 'snap-anubis-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './anubis-admin.component.html',
  styleUrl: './anubis-admin.component.scss',
})
export class AnubisAdminComponent implements OnInit, OnDestroy {
  private readonly bff = inject(BffService);

  readonly status = signal<AnubisStatus | null>(null);
  readonly metrics = signal<AnubisMetric[]>([]);
  readonly rawMetrics = signal('');
  readonly loading = signal(true);
  readonly metricsLoading = signal(false);
  readonly autoRefresh = signal(true);
  readonly showRaw = signal(false);
  readonly activeTab = signal<'status' | 'metrics'>('status');

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadStatus();
    await this.loadMetrics();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  async loadStatus(): Promise<void> {
    this.loading.set(true);
    try {
      this.status.set(await this.bff.anubisStatus());
    } finally {
      this.loading.set(false);
    }
  }

  async loadMetrics(): Promise<void> {
    this.metricsLoading.set(true);
    try {
      const r = await this.bff.anubisMetrics();
      this.metrics.set(r.metrics);
      this.rawMetrics.set(r.raw);
    } finally {
      this.metricsLoading.set(false);
    }
  }

  toggleAutoRefresh(): void {
    this.autoRefresh.update(v => !v);
    if (this.autoRefresh()) {
      this.startAutoRefresh();
    } else {
      this.clearTimer();
    }
  }

  toggleRaw(): void {
    this.showRaw.update(v => !v);
  }

  setTab(tab: 'status' | 'metrics'): void {
    this.activeTab.set(tab);
  }

  private startAutoRefresh(): void {
    this.clearTimer();
    this.refreshTimer = setInterval(() => this.loadMetrics(), 30_000);
  }

  private clearTimer(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
