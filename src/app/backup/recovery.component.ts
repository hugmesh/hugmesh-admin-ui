import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BackupRecord } from '../bff.service';
import { BackupStore } from './backup-store.service';

/**
 * Admin "Recovery" view (ROLE_ADMIN only, route-guarded). Lists the available
 * backups (from cloud storage history AND any found on a connected USB device),
 * lets the admin select one, prompts for the decryption password when the backup
 * is encrypted, previews the scope that will be restored, then triggers the
 * restore and streams the worker's progress into an aria-live region.
 *
 * <p>SECURITY/a11y: the decryption password is handed straight to the BFF (which
 * verifies it against the stored PBKDF2 verifier — a wrong password is a 403 and
 * the key is never revealed) and is never stored/logged here; progress + errors
 * are announced via role=status / role=alert live regions.
 */
@Component({
  selector: 'snap-recovery',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recovery.component.html',
  styleUrl: './recovery.component.scss',
})
export class RecoveryComponent implements OnInit {
  readonly store = inject(BackupStore);

  readonly selected = signal<BackupRecord | null>(null);
  password = '';
  readonly error = signal<string>('');
  readonly starting = signal<boolean>(false);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.store.refreshHistory(), this.store.refreshUsbDevices()]);
  }

  /** Only completed backups are restorable sources. */
  restorable(): BackupRecord[] {
    return this.store.history().filter((b) => b.status === 'COMPLETED');
  }

  select(rec: BackupRecord): void {
    this.selected.set(rec);
    this.password = '';
    this.error.set('');
  }

  scopeList(rec: BackupRecord): string[] {
    return rec.scope ? rec.scope.split(',') : [];
  }

  async start(): Promise<void> {
    const rec = this.selected();
    if (!rec) { this.error.set('Select a backup to restore.'); return; }
    if (rec.encrypted && this.password.length < 8) {
      this.error.set('This backup is encrypted — enter its decryption password (at least 8 characters).');
      return;
    }
    this.error.set('');
    this.starting.set(true);
    try {
      await this.store.startRestore({
        backupId: rec.id,
        scope: null, // restore the source's full scope (preview shows it)
        password: rec.encrypted ? this.password : null,
      });
      this.password = '';
    } catch (e) {
      // The BFF returns "incorrect decryption password" (403) on a wrong password.
      this.error.set(e instanceof Error ? e.message : 'Restore could not be started.');
    } finally {
      this.starting.set(false);
    }
  }
}
