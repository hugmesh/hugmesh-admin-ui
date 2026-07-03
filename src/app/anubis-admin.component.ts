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

  /** The Anubis sidecar status + BFF-reflected config settings. Null while loading. */
  readonly status = signal<AnubisStatus | null>(null);
  /** Parsed Prometheus metric lines from the last metrics poll. */
  readonly metrics = signal<AnubisMetric[]>([]);
  /** The raw (unparsed) Prometheus text from the last poll. Shown when `showRaw` is true. */
  readonly rawMetrics = signal('');
  /** True during the initial status load. */
  readonly loading = signal(true);
  /** True during a metrics refresh (shows a spinner on the metrics tab). */
  readonly metricsLoading = signal(false);
  /** Whether the 30-second auto-refresh of metrics is enabled. */
  readonly autoRefresh = signal(true);
  /** Whether to display the raw Prometheus text rather than the parsed table. */
  readonly showRaw = signal(false);
  /** The currently-active tab in the console (`status` or `metrics`). */
  readonly activeTab = signal<'status' | 'metrics'>('status');

  /** The setInterval handle for the auto-refresh timer; null when not running. */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    // Load status and initial metrics, then start the auto-refresh timer.
    await this.loadStatus();
    await this.loadMetrics();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    // Clear the timer on destroy to prevent the interval from firing after the component is gone.
    this.clearTimer();
  }

  /**
   * Fetch the Anubis sidecar status from `GET /bff/admin/anubis/status`.
   * When `enabled=false` the BFF has no sidecar configured (the default until the
   * sidecar is deployed); the template shows a "not configured" banner in that case.
   */
  async loadStatus(): Promise<void> {
    this.loading.set(true);
    try {
      this.status.set(await this.bff.anubisStatus());
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fetch the Anubis Prometheus metrics from `GET /bff/admin/anubis/metrics`.
   * The BFF proxies the Anubis metrics endpoint and parses the Prometheus text into
   * structured `AnubisMetric` objects + the raw text for the raw-view toggle.
   */
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

  /**
   * Toggle the 30-second auto-refresh for metrics. When turning off, the existing timer
   * is cleared immediately. When turning on, a new timer is started.
   */
  toggleAutoRefresh(): void {
    this.autoRefresh.update(v => !v);
    if (this.autoRefresh()) {
      this.startAutoRefresh();
    } else {
      this.clearTimer();
    }
  }

  /** Toggle between the parsed metrics table and the raw Prometheus text view. */
  toggleRaw(): void {
    this.showRaw.update(v => !v);
  }

  /**
   * Switch the active tab.
   *
   * @param tab - `'status'` or `'metrics'`.
   */
  setTab(tab: 'status' | 'metrics'): void {
    this.activeTab.set(tab);
  }

  /**
   * Start (or restart) the 30-second auto-refresh interval for metrics.
   * Clears any existing timer first to avoid accumulating multiple intervals.
   */
  private startAutoRefresh(): void {
    this.clearTimer();
    this.refreshTimer = setInterval(() => this.loadMetrics(), 30_000);
  }

  /**
   * Clear the auto-refresh timer if one is running. Safe to call when no timer exists.
   */
  private clearTimer(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
