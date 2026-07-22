import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SessionService } from '../session.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import {
  BackupArtifact,
  BackupSet,
  CloudBackupApiError,
  CloudBackupsService,
} from './cloud-backups.service';

/**
 * The BACKUP SETS view — the ADMIN/SUPERADMIN list of the per-domain backup sets
 * over /bff/admin/cloud-backups (BackupAdminController), with:
 *
 *   load      → GET  /bff/admin/cloud-backups[?domain=]  (own-domain; SA ?domain= filter)
 *   versions  → GET  /bff/admin/cloud-backups/{id}/versions   (the version chain)
 *   artifacts → GET  /bff/admin/cloud-backups/{id}/artifacts   (per-service detail)
 *   restore   → POST /bff/admin/cloud-backups/{id}/restore  (PRIVILEGED: X-Backup-StepUp)
 *
 * Each row shows the scope BADGE (DOMAIN / TOTAL) and version. Expanding a set
 * loads its version chain + per-service artifacts. Restore is destructive, so it
 * is a deliberate two-step: a confirm panel, then a 403 whose message names
 * step-up ({@link CloudBackupApiError#isStepUpRequired}) opens the inline
 * {@link MfaStepUpDialogComponent} and the SAME restore is retried automatically
 * once the dialog reports success — no token on the retry, since the A5-unified
 * BackupStepUpGate reads the fresh MFA stamp off this session. A plain role-403 is
 * still a graceful deny.
 *
 * The `domain` filter input is shown ONLY to a superadmin (the bff ignores it for
 * a scoped admin — an admin always reads their own brand).
 *
 * loading / empty / error states; a 401/403 degrades gracefully.
 */
@Component({
  selector: 'hug-cloud-backup-sets',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './cloud-backup-sets.component.html',
  styleUrl: './cloud-backups.scss',
})
export class CloudBackupSetsComponent implements OnInit {
  private readonly api = inject(CloudBackupsService);
  private readonly session = inject(SessionService);

  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  // ── list ──
  readonly rows = signal<BackupSet[] | null>(null);
  readonly loading = signal(false);
  readonly listError = signal('');
  /** SUPERADMIN cross-domain filter (ignored by the bff for a scoped admin). */
  readonly domainFilter = signal('');

  // ── expansion (version chain + artifacts) ──
  readonly expandedId = signal('');
  readonly versions = signal<BackupSet[]>([]);
  readonly artifacts = signal<BackupArtifact[]>([]);
  readonly detailError = signal('');

  // ── restore confirm ──
  /** The set id pending restore confirmation, or '' when no confirm is open. */
  readonly restoreTargetId = signal('');
  readonly restoring = signal(false);
  readonly restoreError = signal('');
  readonly notice = signal('');

  /** A pending step-up challenge for the restore, or null when none is in flight.
   *  `retry` re-attempts the SAME restore once the inline
   *  {@link MfaStepUpDialogComponent} reports the challenge satisfied. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  /** Sorted: newest createdAt first. */
  readonly sortedRows = computed(() => {
    const r = this.rows();
    if (!r) return null;
    return [...r].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  });

  trackId = (_: number, s: BackupSet): string => s.id;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.listError.set('');
    this.expandedId.set('');
    try {
      const filter = this.isSuperadmin() ? this.domainFilter().trim() : '';
      this.rows.set(await this.api.listSets(filter || undefined));
    } catch (e) {
      this.rows.set(null);
      if (e instanceof CloudBackupApiError && (e.isForbidden || e.isUnauthorized)) {
        // Degrade: the bff denied (no role / no session). Show the empty, deny note.
        this.rows.set([]);
        this.listError.set('The server denied access to backups. An admin or superadmin role is required.');
      } else {
        this.listError.set('Could not load backups. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  isExpanded(id: string): boolean {
    return this.expandedId() === id;
  }

  /** Toggle a set's detail (version chain + artifacts). Collapsing clears detail. */
  async toggle(set: BackupSet): Promise<void> {
    if (this.expandedId() === set.id) {
      this.expandedId.set('');
      return;
    }
    this.expandedId.set(set.id);
    this.versions.set([]);
    this.artifacts.set([]);
    this.detailError.set('');
    try {
      const [v, a] = await Promise.all([this.api.versions(set.id), this.api.artifacts(set.id)]);
      this.versions.set(v);
      this.artifacts.set(a);
    } catch (e) {
      if (e instanceof CloudBackupApiError && e.isNotFound) {
        this.detailError.set('This backup is no longer available.');
      } else {
        this.detailError.set('Could not load the version history or artifacts. Please try again.');
      }
    }
  }

  // ── restore (privileged) ──

  /** Open the destructive-restore confirm panel for a set. */
  askRestore(set: BackupSet): void {
    this.restoreTargetId.set(set.id);
    this.restoreError.set('');
    this.notice.set('');
  }

  cancelRestore(): void {
    this.restoreTargetId.set('');
    this.restoreError.set('');
    this.stepUpChallenge.set(null);
  }

  canRestore(): boolean {
    return this.restoreTargetId().length > 0 && !this.restoring();
  }

  /** Confirm the restore: POST .../restore. No token is sent — the A5-unified
   *  BackupStepUpGate is satisfied by a fresh MFA stamp on this session. A 403
   *  naming step-up ({@link CloudBackupApiError#isStepUpRequired}) opens the inline
   *  MFA dialog and the SAME restore is retried on success; a plain role-403 is a
   *  graceful deny. */
  async confirmRestore(): Promise<void> {
    if (!this.canRestore()) return;
    const id = this.restoreTargetId();
    this.restoring.set(true);
    this.restoreError.set('');
    try {
      const res = await this.api.restore(id);
      this.notice.set(
        `Restore queued for version ${res.version} (status: ${res.status}). ` +
          `Restore overwrites live state — monitor its progress in the cluster.`,
      );
      this.cancelRestore();
      await this.load();
    } catch (e) {
      if (e instanceof CloudBackupApiError && e.isStepUpRequired) {
        this.offerStepUp('Restoring this backup', () => this.confirmRestore());
      } else if (e instanceof CloudBackupApiError && e.isForbidden) {
        this.restoreError.set('The server denied the restore — an admin or superadmin role is required.');
      } else if (e instanceof CloudBackupApiError && e.isNotFound) {
        this.restoreError.set('This backup is no longer available to restore.');
      } else {
        this.restoreError.set('Could not start the restore. Please try again.');
      }
    } finally {
      this.restoring.set(false);
    }
  }

  /** Offer the inline MFA step-up dialog for a restore that just 403'd with the
   *  "requires step-up" contract. `retry` is invoked once the dialog reports success. */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the restore it was blocking
   *  (the BFF now reads a fresh MFA stamp off this session; no token is needed). */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }
}
