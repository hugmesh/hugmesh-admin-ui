import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  WorkloadCapability,
  WorkloadEvent,
  WorkloadGrant,
  WorkloadIntent,
  WorkloadMetric,
  WorkloadNetwork,
  WorkloadPod,
  WorkloadPodInspect,
  WorkloadVolume,
} from '../bff.service';
import { SessionService } from '../session.service';

/**
 * The WORKLOAD CONSOLE (podman/OpenShift-equivalent pod-management) remote — the HIDDEN-tier
 * surface backed by the admin-bff WorkloadAdminController / WorkloadSuperadminController.
 * Clones the device-licenses console shape: standalone + signals + the {@link BffService}
 * fetch idiom + a11y (aria-labelledby, role=alert aria-live, table semantics, descriptive
 * destructive-confirm verbs).
 *
 * <p>An ADMIN sees a READ-ONLY view (status / topology / metrics / events / storage /
 * network, + non-stream redacted logs when their grant carries log_access). A SUPERADMIN
 * additionally gets the runtime mutations (rollout-restart = pod delete, delete pod), the
 * GitOps lifecycle intents (scale / deploy digest-pinned / service-removal strong-confirm /
 * export-manifest), the live log viewer + the interactive TTY (those open the sibling
 * components), and the grants/config control plane. Every DANGEROUS action requires a
 * step-up token (minted via {@link BffService#workloadStepUp}) — the server enforces it.
 */
@Component({
  selector: 'snap-workload-console',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workload-console.component.html',
  styleUrl: './workload-console.component.scss',
})
export class WorkloadConsoleComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  readonly capability = signal<WorkloadCapability | null>(null);
  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  /** The app-tier namespaces to inspect (the superadmin all-pods view also offered). */
  namespace = 'snapdragon-backend';
  readonly pods = signal<WorkloadPod[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  /** The inspect drawer (projected DTO + tabs). */
  readonly selected = signal<WorkloadPodInspect | null>(null);
  activeTab: 'detail' | 'metrics' | 'events' | 'storage' | 'network' | 'logs' = 'detail';
  readonly metrics = signal<WorkloadMetric[]>([]);
  readonly events = signal<WorkloadEvent[]>([]);
  readonly storage = signal<WorkloadVolume[]>([]);
  readonly network = signal<WorkloadNetwork[]>([]);
  readonly logBody = signal('');

  /** SUPERADMIN step-up + lifecycle. */
  readonly stepUpToken = signal<string | null>(null);
  readonly stepUpExpiresHint = signal('');
  readonly pendingIntents = signal<WorkloadIntent[]>([]);
  readonly actionMsg = signal('');

  /** SUPERADMIN grants/config. */
  readonly grants = signal<WorkloadGrant[]>([]);
  readonly config = signal<{ id: string; domain: string; adminEnabled: boolean; dangerousTierEnabled: boolean }[]>([]);
  grantGrantee = '';
  grantDomain = '';
  grantLogAccess = false;
  grantTtlHours: number | null = 24;
  readonly grantError = signal('');

  async ngOnInit(): Promise<void> {
    this.capability.set(await this.bff.workloadCapability());
    await this.reload();
    if (this.isSuperadmin()) {
      await this.reloadSuperadmin();
    }
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const pods = this.isSuperadmin() && this.namespace === '*'
        ? await this.bff.workloadAllPods()
        : await this.bff.workloadPods(this.namespace);
      this.pods.set(pods);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async reloadSuperadmin(): Promise<void> {
    try {
      this.grants.set(await this.bff.workloadGrants());
      this.config.set(await this.bff.workloadConfig());
      this.pendingIntents.set(await this.bff.workloadPendingIntents());
    } catch {
      /* control-plane reload is best-effort; the pod view still works */
    }
  }

  // ── inspect drawer + tabs ──────────────────────────────────────────────────
  async inspect(pod: WorkloadPod): Promise<void> {
    this.activeTab = 'detail';
    this.metrics.set([]); this.events.set([]); this.storage.set([]); this.network.set([]); this.logBody.set('');
    this.selected.set(await this.bff.workloadInspect(pod.namespace, pod.name));
  }

  closeDrawer(): void {
    this.selected.set(null);
  }

  async showTab(tab: typeof this.activeTab): Promise<void> {
    this.activeTab = tab;
    const p = this.selected();
    if (!p) return;
    try {
      switch (tab) {
        case 'metrics': this.metrics.set(await this.bff.workloadMetrics(p.namespace)); break;
        case 'events': this.events.set(await this.bff.workloadEvents(p.namespace)); break;
        case 'storage': this.storage.set(await this.bff.workloadStorage(p.namespace)); break;
        case 'network': this.network.set(await this.bff.workloadNetwork(p.namespace)); break;
        case 'logs': {
          const res = await this.bff.workloadLogs(p.namespace, p.name);
          this.logBody.set(res.log);
          break;
        }
        default: break;
      }
    } catch (e) {
      this.error.set(this.message(e));
    }
  }

  // ── SUPERADMIN runtime mutations + step-up ──────────────────────────────────
  async stepUp(): Promise<void> {
    this.actionMsg.set('');
    try {
      const s = await this.bff.workloadStepUp();
      this.stepUpToken.set(s.stepUpToken);
      this.stepUpExpiresHint.set(`step-up valid for ~${s.ttlMinutes} min`);
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  async rolloutRestart(pod: WorkloadPod): Promise<void> {
    if (!confirm(`Restart workload "${pod.workload}" in ${pod.namespace}? This deletes its pods (the controller recreates them).`)) return;
    try {
      await this.bff.workloadRolloutRestart(pod.namespace, pod.workload);
      this.actionMsg.set(`Requested rollout-restart of ${pod.workload}.`);
      await this.reload();
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  async deletePod(pod: WorkloadPod): Promise<void> {
    if (!confirm(`Delete pod "${pod.name}" in ${pod.namespace}? The controller will recreate it.`)) return;
    try {
      await this.bff.workloadDeletePod(pod.namespace, pod.name);
      this.actionMsg.set(`Deleted pod ${pod.name}.`);
      await this.reload();
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  // ── SUPERADMIN grants control plane ─────────────────────────────────────────
  async issueGrant(): Promise<void> {
    this.grantError.set('');
    const grantee = this.grantGrantee.trim();
    const domain = this.grantDomain.trim();
    if (!grantee || !domain) {
      this.grantError.set('Enter a grantee subject and a target domain.');
      return;
    }
    try {
      await this.bff.workloadGrant({
        grantee, targetDomain: domain, logAccess: this.grantLogAccess, ttlHours: this.grantTtlHours,
      });
      this.grantGrantee = ''; this.grantLogAccess = false;
      this.grants.set(await this.bff.workloadGrants());
    } catch (e) {
      this.grantError.set(this.message(e));
    }
  }

  async revokeGrant(g: WorkloadGrant): Promise<void> {
    if (!confirm(`Revoke ${g.grantee}'s workload-console grant in ${g.targetDomain}?`)) return;
    try {
      await this.bff.workloadRevokeGrant(g.id);
      this.grants.set(await this.bff.workloadGrants());
    } catch (e) {
      this.grantError.set(this.message(e));
    }
  }

  async toggleConfig(domain: string, adminEnabled: boolean, dangerousTierEnabled: boolean): Promise<void> {
    try {
      await this.bff.workloadPutConfig(domain, adminEnabled, dangerousTierEnabled);
      this.config.set(await this.bff.workloadConfig());
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  private message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
