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
  selector: 'hug-workload-console',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workload-console.component.html',
  styleUrl: './workload-console.component.scss',
})
export class WorkloadConsoleComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /**
   * The capability probe result — present (non-null) only when the caller has a live grant/role.
   * Null while loading or when the probe returned 404 (no grant/role → the `workloadConsoleGuard`
   * already blocked; this signal is a belt-and-suspenders check for any state that bypasses the guard).
   */
  readonly capability = signal<WorkloadCapability | null>(null);
  /** True when the session carries ROLE_SUPERADMIN — unlocks the mutation + grants control plane. */
  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  /**
   * The Kubernetes namespace to inspect. The SUPERADMIN may also pass `*` to list pods in
   * all namespaces (the BFF maps that to an all-namespaces list; an ADMIN is scoped to their domain).
   */
  namespace = 'hugmesh-backend';
  /** The pod list for the current namespace (or all namespaces for SA `*`). */
  readonly pods = signal<WorkloadPod[]>([]);
  /** True while a pod list or mutation call is in flight. */
  readonly loading = signal(false);
  /** Error message from the most recent failed call. Displayed in an aria-live region. */
  readonly error = signal('');

  // ── Inspect drawer (projected DTO + per-tab data) ──────────────────────
  /** The pod being inspected in the side drawer — null when the drawer is closed. */
  readonly selected = signal<WorkloadPodInspect | null>(null);
  /** The currently-active tab in the inspect drawer. `logs` requires a grant with log_access. */
  activeTab: 'detail' | 'metrics' | 'events' | 'storage' | 'network' | 'logs' = 'detail';
  /** CPU/memory metrics for the selected pod's namespace. */
  readonly metrics = signal<WorkloadMetric[]>([]);
  /** Recent warning/normal events for the selected pod's namespace. */
  readonly events = signal<WorkloadEvent[]>([]);
  /** PVC volumes for the selected pod's namespace. */
  readonly storage = signal<WorkloadVolume[]>([]);
  /** Services and ingress rules for the selected pod's namespace. */
  readonly network = signal<WorkloadNetwork[]>([]);
  /**
   * Non-stream redacted log text for the selected pod (the `logs` tab).
   * REQUIRES a grant with `log_access=true`; the BFF redacts lines matching
   * PII/secret patterns before returning.
   */
  readonly logBody = signal('');

  // ── SUPERADMIN: step-up token + GitOps lifecycle ───────────────────────
  /**
   * The step-up token last minted via {@link stepUp}, or null until one is. It is NOT cleared
   * when its server-side TTL lapses (nothing here tracks expiry), so a stale token can be
   * forwarded; the BFF's TTL check is authoritative wherever it validates the token.
   */
  readonly stepUpToken = signal<string | null>(null);
  /** Human-readable hint about when the step-up token expires (e.g. "step-up valid for ~5 min"). */
  readonly stepUpExpiresHint = signal('');
  /** Pending GitOps-PR lifecycle intents (scale/deploy/remove) queued for reconcile. */
  readonly pendingIntents = signal<WorkloadIntent[]>([]);
  /** Result message from the most recent lifecycle or grants action. */
  readonly actionMsg = signal('');

  // ── SUPERADMIN: grants and config control plane ────────────────────────
  /** The active READ_ONLY grant leases issued by this superadmin. */
  readonly grants = signal<WorkloadGrant[]>([]);
  /**
   * The per-domain kill-switch config rows (adminEnabled / dangerousTierEnabled).
   * `adminEnabled=false` prevents admins from reaching the console for a domain.
   * `dangerousTierEnabled=false` disables step-up mutations for everyone.
   */
  readonly config = signal<{ id: string; domain: string; adminEnabled: boolean; dangerousTierEnabled: boolean }[]>([]);
  /** Grantee subject for the new-grant form (ngModel-bound plain property). */
  grantGrantee = '';
  /** Target domain for the new-grant form (ngModel-bound plain property). */
  grantDomain = '';
  /** Whether the new grant should include read-access to redacted logs. */
  grantLogAccess = false;
  /** TTL hours for the new grant (null = no expiry). Defaults to 24. */
  grantTtlHours: number | null = 24;
  /** Error from the grants control-plane call. Displayed in an aria-live region. */
  readonly grantError = signal('');

  async ngOnInit(): Promise<void> {
    // Probe the capability first (404 = no grant/role; the guard already blocked, but
    // re-check here for belt-and-suspenders and to populate the readOnly flag).
    this.capability.set(await this.bff.workloadCapability());
    await this.reload();
    // Load the superadmin control-plane data (grants + config + pending intents) —
    // only for a SUPERADMIN session. Best-effort: failure does not affect the pod view.
    if (this.isSuperadmin()) {
      await this.reloadSuperadmin();
    }
  }

  /**
   * Reload the pod list for the current namespace. A SUPERADMIN may pass `namespace = '*'`
   * to list all namespaces; an ADMIN is always scoped to their domain's namespace.
   */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      // Choose the right list endpoint: all-pods for a SA `*` namespace, or namespace-scoped.
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

  /**
   * Reload the SUPERADMIN control-plane state (grants + config + pending GitOps intents).
   * Best-effort — a failure is silently swallowed so the pod view continues working.
   */
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

  /**
   * Open the inspect drawer for a pod. Clears the per-tab data from any previous selection
   * before fetching the fresh projected DTO (NO env / annotations / managedFields / secrets).
   *
   * @param pod - The pod row from the pod list.
   */
  async inspect(pod: WorkloadPod): Promise<void> {
    this.activeTab = 'detail';
    // Clear stale tab data before opening (avoids a flash of old content if the
    // previous pod happened to be in the same namespace).
    this.metrics.set([]); this.events.set([]); this.storage.set([]); this.network.set([]); this.logBody.set('');
    this.selected.set(await this.bff.workloadInspect(pod.namespace, pod.name));
  }

  /** Close the inspect drawer and clear the selection. */
  closeDrawer(): void {
    this.selected.set(null);
  }

  /**
   * Switch the inspect drawer to a tab and load its data lazily.
   * The `logs` tab requires a grant with `log_access=true`; the BFF enforces this and
   * redacts any sensitive lines before returning.
   *
   * @param tab - The target tab identifier.
   */
  async showTab(tab: typeof this.activeTab): Promise<void> {
    this.activeTab = tab;
    const p = this.selected();
    if (!p) return;
    try {
      switch (tab) {
        // Load namespace-level metrics (CPU + memory via metrics-server).
        case 'metrics': this.metrics.set(await this.bff.workloadMetrics(p.namespace)); break;
        // Load recent warning/normal events from the k8s event stream.
        case 'events': this.events.set(await this.bff.workloadEvents(p.namespace)); break;
        // Load PVC volume status for the namespace.
        case 'storage': this.storage.set(await this.bff.workloadStorage(p.namespace)); break;
        // Load service + ingress network topology for the namespace.
        case 'network': this.network.set(await this.bff.workloadNetwork(p.namespace)); break;
        // Load a non-stream snapshot of the pod's redacted logs (grant-gated + server-redacted).
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

  /**
   * Mint a short-TTL step-up token from the BFF and hold it in {@link stepUpToken}. The BFF
   * VALIDATES X-Workload-StepUp only for its DANGEROUS tier (live log-stream / exec /
   * port-forward / GitOps lifecycle). In this view the held token is forwarded by
   * {@link rolloutRestart} and {@link deletePod}. For ordinary names those are the BFF's
   * RUNTIME_MUTATE tier and do NOT require step-up, so the UI does not make minting a
   * precondition. But the BFF's tierOf substring match puts a namespace / workload / pod
   * whose name BEGINS with exec, lifecycle or port-forward (or namespace `logs` with a name
   * beginning `stream`) in DANGEROUS. For those names the kill applies, and the call needs
   * this token (see the note above `BffService.workloadRolloutRestart`). (The terminal view
   * mints its own token.)
   */
  async stepUp(): Promise<void> {
    this.actionMsg.set('');
    try {
      const s = await this.bff.workloadStepUp();
      this.stepUpToken.set(s.stepUpToken);
      // Surface the expiry so the SUPERADMIN knows how long the token is valid.
      this.stepUpExpiresHint.set(`step-up valid for ~${s.ttlMinutes} min`);
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  /**
   * Request a rollout-restart (pod-delete) on the workload owning the given pod.
   * The k8s controller recreates the pods. The token minted via {@link stepUp}, if one is
   * held, rides X-Workload-StepUp; with none, no header is sent. For ordinary names the BFF
   * does NOT require it (RUNTIME_MUTATE: SUPERADMIN + not suspended + namespace allowlist is
   * the gate), so there it is forwarded for parity only. For a namespace / workload name that
   * BEGINS with exec, lifecycle or port-forward, the BFF misclassifies the call as DANGEROUS.
   * There the forwarded token is validated and is what lets the call through (dangerous-tier
   * kill permitting); without one it is "HTTP 403". See the note above
   * `BffService.workloadRolloutRestart`.
   *
   * @param pod - The pod whose owning workload to restart.
   */
  async rolloutRestart(pod: WorkloadPod): Promise<void> {
    if (!confirm(`Restart workload "${pod.workload}" in ${pod.namespace}? This deletes its pods (the controller recreates them).`)) return;
    try {
      await this.bff.workloadRolloutRestart(pod.namespace, pod.workload, this.stepUpToken() ?? undefined);
      this.actionMsg.set(`Requested rollout-restart of ${pod.workload}.`);
      await this.reload();
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  /**
   * Delete a specific pod (the controller will recreate it). Forwards the held step-up token
   * exactly like {@link rolloutRestart}, with the same BFF treatment: RUNTIME_MUTATE with the
   * token unchecked for ordinary names, but DANGEROUS (token validated, kill applies) for a
   * namespace / pod name beginning with exec, lifecycle or port-forward.
   *
   * @param pod - The pod to delete.
   */
  async deletePod(pod: WorkloadPod): Promise<void> {
    if (!confirm(`Delete pod "${pod.name}" in ${pod.namespace}? The controller will recreate it.`)) return;
    try {
      await this.bff.workloadDeletePod(pod.namespace, pod.name, this.stepUpToken() ?? undefined);
      this.actionMsg.set(`Deleted pod ${pod.name}.`);
      await this.reload();
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  // ── SUPERADMIN grants control plane ─────────────────────────────────────────

  /**
   * Issue a READ_ONLY workload-console grant to an admin (`POST /bff/superadmin/workloads/grants`).
   * The grant allows that admin to reach the workload console for the target domain.
   * Optionally includes `log_access` (redacted log reads) and a TTL (null = no expiry).
   */
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
      // Clear grantee + logAccess (leave domain for quick multi-grant to the same domain).
      this.grantGrantee = ''; this.grantLogAccess = false;
      this.grants.set(await this.bff.workloadGrants());
    } catch (e) {
      this.grantError.set(this.message(e));
    }
  }

  /**
   * Revoke an existing grant (`DELETE /bff/superadmin/workloads/grants/{id}`). The admin
   * loses workload-console access for the granted domain immediately.
   *
   * @param g - The grant row to revoke.
   */
  async revokeGrant(g: WorkloadGrant): Promise<void> {
    if (!confirm(`Revoke ${g.grantee}'s workload-console grant in ${g.targetDomain}?`)) return;
    try {
      await this.bff.workloadRevokeGrant(g.id);
      this.grants.set(await this.bff.workloadGrants());
    } catch (e) {
      this.grantError.set(this.message(e));
    }
  }

  /**
   * Toggle the kill-switch config for a domain (`PUT /bff/superadmin/workloads/config/{domain}`).
   * `adminEnabled=false` blocks all admin access to the console for that domain.
   * `dangerousTierEnabled=false` disables step-up mutations for everyone (superadmin included).
   *
   * @param domain - The domain whose config to update.
   * @param adminEnabled - Whether admins may access the console for this domain.
   * @param dangerousTierEnabled - Whether dangerous-tier mutations are permitted.
   */
  async toggleConfig(domain: string, adminEnabled: boolean, dangerousTierEnabled: boolean): Promise<void> {
    try {
      await this.bff.workloadPutConfig(domain, adminEnabled, dangerousTierEnabled);
      this.config.set(await this.bff.workloadConfig());
    } catch (e) {
      this.actionMsg.set(this.message(e));
    }
  }

  /**
   * Extract a human-readable message from an unknown thrown value.
   *
   * @param e - The caught error (any type).
   * @returns The error's `.message` property if it is an `Error`; otherwise its string form.
   */
  private message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
