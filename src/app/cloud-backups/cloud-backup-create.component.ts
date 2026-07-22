import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  BackupDestination,
  BackupDestinationKind,
  CloudBackupApiError,
  CloudBackupsService,
  RunningService,
} from './cloud-backups.service';

/**
 * The CREATE BACKUP view — pick the running services to back up (the per-service
 * menu) + the destination, then create a DOMAIN-scope backup:
 *
 *   menu   → GET  /bff/admin/cloud-backups/services       (RunningService[])
 *   dest   → GET  /bff/admin/cloud-backups/destinations   (prefill the destination)
 *   create → POST /bff/admin/cloud-backups {setKey?, services[], destinationKind,
 *            destinationRef, encryptionMeta?}             → BackupSet
 *
 * SCOPE: this endpoint is ALWAYS DOMAIN (the bff stamps scope=DOMAIN); the UI never
 * sends a scope/domain/createdBy field — they are server-side. (TOTAL is the
 * superadmin-only tab.) Optional services (akkoma/matrix/phpbb/games/tube/owncast)
 * are shown but NOT selectable when the bff flags them optional+not-installed —
 * the greyed-out degrade.
 *
 * loading / empty / error; a 401/403 degrades gracefully.
 */
@Component({
  selector: 'hug-cloud-backup-create',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cloud-backup-create.component.html',
  styleUrl: './cloud-backups.scss',
})
export class CloudBackupCreateComponent implements OnInit {
  private readonly api = inject(CloudBackupsService);

  // ── per-service menu ──
  readonly services = signal<RunningService[]>([]);
  readonly menuLoading = signal(false);
  readonly menuError = signal('');
  /** Selected service keys. */
  readonly selected = signal<Set<string>>(new Set());

  // ── destination ──
  readonly destinationKind = signal<BackupDestinationKind>('object_store');
  readonly destinationRef = signal('');
  /** The configured per-domain destination (prefill), or null when unset. */
  readonly configuredDestination = signal<BackupDestination | null>(null);

  // ── form ──
  readonly setKey = signal('');
  readonly encryptionMeta = signal('');
  readonly busy = signal(false);
  readonly touched = signal(false);
  readonly formError = signal('');
  readonly notice = signal('');

  readonly kinds: ReadonlyArray<{ value: BackupDestinationKind; label: string }> = [
    { value: 'object_store', label: 'Object store (S3 / MinIO)' },
    { value: 'node_storage', label: 'Node storage (device-attached FDE volume)' },
  ];

  trackKey = (_: number, s: RunningService): string => s.key;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadServices(), this.loadDestination()]);
  }

  private async loadServices(): Promise<void> {
    this.menuLoading.set(true);
    this.menuError.set('');
    try {
      this.services.set(await this.api.services());
    } catch (e) {
      this.services.set([]);
      if (e instanceof CloudBackupApiError && (e.isForbidden || e.isUnauthorized)) {
        this.menuError.set('The server denied the service menu — an admin or superadmin role is required.');
      } else {
        this.menuError.set('Could not load the running-services menu. Please try again.');
      }
    } finally {
      this.menuLoading.set(false);
    }
  }

  /** Best-effort prefill of the configured destination (not fatal if unset/denied). */
  private async loadDestination(): Promise<void> {
    try {
      const d = await this.api.getDestination();
      if (d) {
        this.configuredDestination.set(d);
        this.destinationKind.set(d.kind);
        this.destinationRef.set(d.destinationRef);
      }
    } catch {
      this.configuredDestination.set(null);
    }
  }

  /** A service is selectable unless it is an OPTIONAL service the bff flagged (the
   *  greyed-out, not-installed degrade). */
  selectable(s: RunningService): boolean {
    return !s.optional;
  }

  isSelected(key: string): boolean {
    return this.selected().has(key);
  }

  toggle(s: RunningService): void {
    if (!this.selectable(s)) return;
    this.selected.update((cur) => {
      const next = new Set(cur);
      next.has(s.key) ? next.delete(s.key) : next.add(s.key);
      return next;
    });
  }

  readonly selectedCount = computed(() => this.selected().size);

  canCreate(): boolean {
    return this.selected().size > 0 && this.destinationRef().trim().length > 0 && !this.busy();
  }

  servicesInvalid(): boolean {
    return this.touched() && this.selected().size === 0;
  }
  destinationRefInvalid(): boolean {
    return this.touched() && this.destinationRef().trim().length === 0;
  }

  /** Create the DOMAIN-scope backup. The body carries ONLY the request intent — the
   *  bff stamps domain + createdBy + scope=DOMAIN. */
  async create(): Promise<void> {
    this.touched.set(true);
    this.formError.set('');
    this.notice.set('');
    if (!this.canCreate()) return;
    this.busy.set(true);
    try {
      const created = await this.api.createSet({
        setKey: this.setKey().trim() || null,
        services: [...this.selected()],
        destinationKind: this.destinationKind(),
        destinationRef: this.destinationRef().trim(),
        encryptionMeta: this.encryptionMeta().trim() || null,
      });
      this.notice.set(
        `Created backup “${created.setKey}” (version ${created.version}, status ${created.status}) ` +
          `for ${created.services.length} service(s).`,
      );
      this.selected.set(new Set());
      this.setKey.set('');
      this.encryptionMeta.set('');
      this.touched.set(false);
    } catch (e) {
      this.formError.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown): string {
    if (e instanceof CloudBackupApiError) {
      if (e.isForbidden) return 'The server denied the backup — an admin or superadmin role is required.';
      if (e.isBadRequest) return e.message || 'The backup request was rejected. Check your selection.';
    }
    return 'Could not create the backup. Please try again.';
  }
}
