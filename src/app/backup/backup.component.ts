import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BackupStore } from './backup-store.service';
import { CapabilityGateComponent } from '../platform/capability-gate.component';
import { PlatformCapabilitiesService } from '../platform/platform-capabilities.service';

/**
 * Admin "Backup" view (ROLE_ADMIN only, route-guarded). Choose WHAT to back up
 * (scopes), the TARGET (in-cluster/cloud storage or a connected USB device listed
 * by the BFF), and optionally encrypt the backup with a password. Triggering posts
 * to the BFF and streams the worker's progress into an aria-live region — a queued
 * action with progress, consistent with the platform's queued-action pattern.
 *
 * <p>SECURITY/a11y: the password + confirm are never logged or stored (handed
 * straight to the store→BFF); a strength hint is shown; progress/errors are
 * announced via role=status / role=alert live regions; every control is labelled
 * and keyboard operable.
 */
@Component({
  selector: 'snap-backup',
  standalone: true,
  imports: [CommonModule, FormsModule, CapabilityGateComponent],
  templateUrl: './backup.component.html',
  styleUrl: './backup.component.scss',
})
export class BackupComponent implements OnInit {
  readonly store = inject(BackupStore);
  private readonly platform = inject(PlatformCapabilitiesService);

  /** Whether Velero (the backup operator) is present on this deployment. When absent the backup
   *  form + actions are suppressed and the capability-gate notice is shown — graceful degradation,
   *  never an error. The BFF stays the authoritative gate on the start-backup action. */
  readonly veleroPresent = this.platform.veleroPresent;
  /** True once the capability probe has resolved (avoids flashing the notice while loading). */
  readonly capabilitiesReady = this.platform.ready;

  /** Selected scope wire-values. */
  readonly selected = signal<Set<string>>(new Set(['etcd']));
  readonly target = signal<'CLUSTER' | 'USB'>('CLUSTER');
  readonly usbDeviceId = signal<string>('');
  readonly encrypt = signal<boolean>(false);

  password = '';
  confirm = '';

  readonly error = signal<string>('');
  readonly starting = signal<boolean>(false);

  /** A simple, non-logging password strength hint (length + variety heuristic). */
  readonly strength = computed(() => scorePassword(this.password));

  async ngOnInit(): Promise<void> {
    await this.platform.load();
    // When Velero is absent, degrade: show the notice, do not fetch backup history / devices.
    if (this.veleroPresent()) {
      await Promise.all([this.store.refreshHistory(), this.store.refreshUsbDevices()]);
    }
  }

  toggleScope(value: string): void {
    this.selected.update((cur) => {
      const next = new Set(cur);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  isSelected(value: string): boolean { return this.selected().has(value); }

  setTarget(t: 'CLUSTER' | 'USB'): void { this.target.set(t); }

  /** Validate then trigger the backup. Field errors are surfaced in a live region. */
  async start(): Promise<void> {
    this.error.set('');
    // Defence-in-depth: never start a backup when Velero is absent (the form is not rendered
    // then; the BFF is the authoritative gate regardless).
    if (!this.veleroPresent()) return;
    const scope = [...this.selected()];
    if (scope.length === 0) { this.error.set('Select at least one thing to back up.'); return; }
    if (this.target() === 'USB' && !this.usbDeviceId()) {
      this.error.set('Select a connected USB device, or choose cluster/cloud storage.');
      return;
    }
    if (this.encrypt()) {
      if (this.password.length < 8) { this.error.set('Encryption password must be at least 8 characters.'); return; }
      if (this.password !== this.confirm) { this.error.set('Passwords do not match.'); return; }
    }

    this.starting.set(true);
    try {
      await this.store.startBackup({
        scope,
        target: this.target(),
        usbDeviceId: this.target() === 'USB' ? this.usbDeviceId() : null,
        encrypt: this.encrypt(),
        password: this.encrypt() ? this.password : null,
      });
      // Never retain the secret after handing it to the BFF.
      this.password = '';
      this.confirm = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Backup could not be started.');
    } finally {
      this.starting.set(false);
    }
  }
}

/** Length+variety strength label. Pure (no logging) — only the label is shown. */
export function scorePassword(pw: string): { label: string; level: number } {
  if (!pw) return { label: '', level: 0 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['very weak', 'weak', 'fair', 'good', 'strong', 'very strong'];
  return { label: labels[Math.min(score, labels.length - 1)], level: score };
}
