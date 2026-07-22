import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SessionService } from '../session.service';
import {
  BackupDestination,
  BackupDestinationKind,
  CloudBackupApiError,
  CloudBackupsService,
} from './cloud-backups.service';

/**
 * The DESTINATION view — view + upsert the per-domain backup destination config:
 *
 *   load → GET /bff/admin/cloud-backups/destinations[?domain=]  (BackupDestination|204)
 *   save → PUT /bff/admin/cloud-backups/destinations {kind, destinationRef, secretRef?,
 *          targetDomain?}                                         → BackupDestination
 *
 * The domain is STAMPED server-side from the validated issuer — the UI never sends
 * a `domain`. `targetDomain` is SUPERADMIN-ONLY (the bff ignores it for a scoped
 * admin), so the targetDomain field is shown ONLY to a superadmin. secretRef is a
 * REFERENCE only (object_store credentials Secret); never credential bytes, and
 * not used for node_storage.
 *
 * loading / empty / error; a 401/403 degrades gracefully.
 */
@Component({
  selector: 'hug-cloud-backup-destination',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cloud-backup-destination.component.html',
  styleUrl: './cloud-backups.scss',
})
export class CloudBackupDestinationComponent implements OnInit {
  private readonly api = inject(CloudBackupsService);
  private readonly session = inject(SessionService);

  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  readonly current = signal<BackupDestination | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal('');

  // ── form ──
  readonly kind = signal<BackupDestinationKind>('object_store');
  readonly destinationRef = signal('');
  readonly secretRef = signal('');
  /** SUPERADMIN-only: configure another brand's destination. */
  readonly targetDomain = signal('');
  readonly busy = signal(false);
  readonly touched = signal(false);
  readonly formError = signal('');
  readonly notice = signal('');

  readonly kinds: ReadonlyArray<{ value: BackupDestinationKind; label: string }> = [
    { value: 'object_store', label: 'Object store (S3 / MinIO)' },
    { value: 'node_storage', label: 'Node storage (device-attached FDE volume)' },
  ];

  /** secretRef applies only to object_store (node_storage is unlocked at the node). */
  readonly secretApplies = computed(() => this.kind() === 'object_store');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const target = this.isSuperadmin() ? this.targetDomain().trim() : '';
      const d = await this.api.getDestination(target || undefined);
      this.current.set(d ?? null);
      if (d) {
        this.kind.set(d.kind);
        this.destinationRef.set(d.destinationRef);
        this.secretRef.set(d.secretRef ?? '');
      }
    } catch (e) {
      this.current.set(null);
      if (e instanceof CloudBackupApiError && (e.isForbidden || e.isUnauthorized)) {
        this.loadError.set('The server denied the destination config — an admin or superadmin role is required.');
      } else {
        this.loadError.set('Could not load the destination config. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  destinationRefInvalid(): boolean {
    return this.touched() && this.destinationRef().trim().length === 0;
  }

  canSave(): boolean {
    return this.destinationRef().trim().length > 0 && !this.busy();
  }

  async save(): Promise<void> {
    this.touched.set(true);
    this.formError.set('');
    this.notice.set('');
    if (!this.canSave()) return;
    this.busy.set(true);
    try {
      const saved = await this.api.putDestination({
        kind: this.kind(),
        destinationRef: this.destinationRef().trim(),
        // secretRef applies only to object_store; node_storage sends none.
        secretRef: this.secretApplies() ? this.secretRef().trim() || null : null,
        // targetDomain only for a superadmin; the bff ignores it for a scoped admin.
        targetDomain: this.isSuperadmin() ? this.targetDomain().trim() || null : null,
      });
      this.current.set(saved);
      this.notice.set(`Saved the destination for ${saved.domain} (${saved.kind}).`);
      this.touched.set(false);
    } catch (e) {
      this.formError.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown): string {
    if (e instanceof CloudBackupApiError) {
      if (e.isForbidden) return 'The server denied the change — an admin or superadmin role is required.';
      if (e.isBadRequest) return e.message || 'The destination request was rejected.';
    }
    return 'Could not save the destination. Please try again.';
  }
}
