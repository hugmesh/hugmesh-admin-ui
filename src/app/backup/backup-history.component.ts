import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BackupStore } from './backup-store.service';

/**
 * Admin "Backups" history view (ROLE_ADMIN only, route-guarded). A small table of
 * the backup history the BFF persists in backup_history: id, time, scope, target,
 * encrypted, size and status. Read-only — starting/restoring lives in the Backup
 * and Recovery views; this is the at-a-glance ledger.
 */
@Component({
  selector: 'hug-backup-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backup-history.component.html',
  styleUrl: './backup-history.component.scss',
})
export class BackupHistoryComponent implements OnInit {
  readonly store = inject(BackupStore);

  async ngOnInit(): Promise<void> {
    await this.store.refreshHistory();
  }

  /** Human-readable size; '—' when unknown (not yet completed). */
  size(bytes?: number | null): string {
    if (bytes == null) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /** CSS status modifier (colour paired with the text label, never colour alone). */
  statusClass(status: string): string {
    switch (status) {
      case 'COMPLETED': return 'is-completed';
      case 'FAILED': return 'is-failed';
      case 'RUNNING': return 'is-running';
      default: return 'is-queued';
    }
  }
}
