import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { SessionService } from '../session.service';
import { CloudBackupSetsComponent } from './cloud-backup-sets.component';
import { CloudBackupCreateComponent } from './cloud-backup-create.component';
import { CloudBackupDestinationComponent } from './cloud-backup-destination.component';
import { CloudBackupTotalComponent } from './cloud-backup-total.component';
import { CapabilityGateComponent } from '../platform/capability-gate.component';
import { PlatformCapabilitiesService } from '../platform/platform-capabilities.service';

/** One tab in the Cloud Backups console. A `superadminOnly` tab (TOTAL) is hidden
 *  from the tab strip unless the session carries the superadmin role — mirroring
 *  the admin.component menu's superadminOnly pattern. The bff is the authoritative
 *  gate (the /bff/superadmin/** endpoint is SUPERADMIN-only); this only governs
 *  the tab's discoverability. */
interface BackupTab {
  id: 'sets' | 'create' | 'destination' | 'total';
  label: string;
  superadminOnly?: boolean;
}

/**
 * The CLOUD BACKUPS console shell (ADMIN/SUPERADMIN, route-guarded by the host's
 * Casdoor admin role on /admin). The UI half of the per-domain + superadmin
 * TOTAL-CLOUD backups feature, over the snapdragon-admin-bff-api `cloudbackup`
 * surfaces (PR #74). Mounted at /admin/cloud-backups — a DISTINCT route from the
 * LEGACY USB Backup/Recovery/Backups-history module (/admin/backup, /admin/recovery,
 * /admin/backups), mirroring the bff's deliberate distinct /bff/admin/cloud-backups
 * prefix vs the legacy /bff/admin/backups.
 *
 * <p>Tabs:
 * <ul>
 *   <li><b>Backup sets</b> — list (scope badge + version chain), per-service
 *       artifacts, and the PRIVILEGED restore (step-up).</li>
 *   <li><b>Create backup</b> — pick services from the running-services menu +
 *       destination, then create a DOMAIN-scope backup.</li>
 *   <li><b>Destination</b> — view/upsert the per-domain destination config.</li>
 *   <li><b>Total cloud</b> — SUPERADMIN-ONLY: create a TOTAL-CLOUD backup
 *       (/bff/superadmin/cloud-backups/total). Hidden from the tab strip for a
 *       non-superadmin (defence-in-depth; the bff is authoritative).</li>
 * </ul>
 *
 * <p>Gating: an ADMIN sees only their OWN-domain scope (the bff resolves the domain
 * from the validated issuer — the UI never sends a domain on a write); the TOTAL
 * surface is SUPERADMIN-only. The UI degrades on a 401/403 from the bff.
 */
@Component({
  selector: 'snap-cloud-backups',
  standalone: true,
  imports: [
    CommonModule,
    CloudBackupSetsComponent,
    CloudBackupCreateComponent,
    CloudBackupDestinationComponent,
    CloudBackupTotalComponent,
    CapabilityGateComponent,
  ],
  templateUrl: './cloud-backups.component.html',
  styleUrl: './cloud-backups.scss',
})
export class CloudBackupsComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly platform = inject(PlatformCapabilitiesService);

  /** Whether the current session is a superadmin — gates the TOTAL tab's visibility
   *  (the bff enforces it authoritatively). */
  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  /** Whether Velero (the backup operator) is present on this deployment. When absent the whole
   *  console is replaced by the capability-gate notice and the tabs/actions are suppressed —
   *  graceful degradation, never an error. The BFF stays the authoritative gate on every action. */
  readonly veleroPresent = this.platform.veleroPresent;
  /** True once the capability probe has resolved (avoids flashing the notice while loading). */
  readonly capabilitiesReady = this.platform.ready;

  async ngOnInit(): Promise<void> {
    await this.platform.load();
  }

  private readonly allTabs: ReadonlyArray<BackupTab> = [
    { id: 'sets', label: 'Backup sets' },
    { id: 'create', label: 'Create backup' },
    { id: 'destination', label: 'Destination' },
    { id: 'total', label: 'Total cloud', superadminOnly: true },
  ];

  /** The tabs the current session may see — the TOTAL tab only for a superadmin. */
  readonly tabs = computed(() => this.allTabs.filter((t) => !t.superadminOnly || this.isSuperadmin()));

  readonly active = signal<BackupTab['id']>('sets');

  select(id: BackupTab['id']): void {
    // Defence-in-depth: never activate a superadmin-only tab for a non-superadmin
    // even if asked (the tab is not rendered, but keep the state honest).
    if (id === 'total' && !this.isSuperadmin()) return;
    this.active.set(id);
  }

  isActive(id: BackupTab['id']): boolean {
    return this.active() === id;
  }
}
