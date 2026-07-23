import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  BackupDestinationKind,
  CloudBackupApiError,
  CloudBackupsService,
  RunningService,
} from './cloud-backups.service';

/**
 * The TOTAL-CLOUD backup view — SUPERADMIN-ONLY. Creates a scope=TOTAL backup over
 * the SUPERADMIN-only endpoint:
 *
 *   menu   → GET  /bff/admin/cloud-backups/services         (RunningService[])
 *   create → POST /bff/superadmin/cloud-backups/total {setKey?, services[],
 *            destinationKind, destinationRef, encryptionMeta?}   → BackupSet (TOTAL)
 *
 * This component is rendered ONLY inside the superadmin-gated TOTAL tab of the
 * console shell (the tab is hidden for a non-superadmin), but the bff is the
 * AUTHORITATIVE gate — the /bff/superadmin/** endpoint is triple-gated
 * SUPERADMIN-only, so an ADMIN who reaches the create call still gets a clean 403,
 * surfaced gracefully here.
 *
 * loading / empty / error; a 401/403 degrades gracefully.
 */
@Component({
  selector: 'hug-cloud-backup-total',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cloud-backup-total.component.html',
  styleUrl: './cloud-backups.scss',
})
export class CloudBackupTotalComponent implements OnInit {
  private readonly api = inject(CloudBackupsService);

  // ── per-service menu ──
  readonly services = signal<RunningService[]>([]);
  readonly menuLoading = signal(false);
  readonly menuError = signal('');
  readonly selected = signal<Set<string>>(new Set());

  // ── destination + options ──
  readonly destinationKind = signal<BackupDestinationKind>('object_store');
  readonly destinationRef = signal('');
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
    await this.loadServices();
  }

  private async loadServices(): Promise<void> {
    this.menuLoading.set(true);
    this.menuError.set('');
    try {
      this.services.set(await this.api.services());
    } catch (e) {
      this.services.set([]);
      if (e instanceof CloudBackupApiError && (e.isForbidden || e.isUnauthorized)) {
        this.menuError.set('The server denied the service menu — a superadmin role is required.');
      } else {
        this.menuError.set('Could not load the running-services menu. Please try again.');
      }
    } finally {
      this.menuLoading.set(false);
    }
  }

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

  servicesInvalid(): boolean {
    return this.touched() && this.selected().size === 0;
  }
  destinationRefInvalid(): boolean {
    return this.touched() && this.destinationRef().trim().length === 0;
  }
  canCreate(): boolean {
    return this.selected().size > 0 && this.destinationRef().trim().length > 0 && !this.busy();
  }

  /** Create the TOTAL-CLOUD backup over the SUPERADMIN-only endpoint. */
  async create(): Promise<void> {
    this.touched.set(true);
    this.formError.set('');
    this.notice.set('');
    if (!this.canCreate()) return;
    this.busy.set(true);
    try {
      const created = await this.api.createTotal({
        setKey: this.setKey().trim() || null,
        services: [...this.selected()],
        destinationKind: this.destinationKind(),
        destinationRef: this.destinationRef().trim(),
        encryptionMeta: this.encryptionMeta().trim() || null,
      });
      this.notice.set(
        `Created TOTAL-CLOUD backup “${created.setKey}” (version ${created.version}, status ` +
          `${created.status}) capturing ${created.services.length} service(s).`,
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
      if (e.isForbidden) return 'The server denied the total-cloud backup — a superadmin role is required.';
      if (e.isBadRequest) return e.message || 'The backup request was rejected. Check your selection.';
    }
    return 'Could not create the total-cloud backup. Please try again.';
  }
}
