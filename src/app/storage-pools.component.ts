import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  StoragePool,
  ServiceAssignment,
  DeviceRegistration,
} from './bff.service';

/**
 * Admin "Node storage" console (own repo: snapdragon-admin-ui). The MVP surface over the
 * NODE STORAGE control plane — ADDITIONAL storage an operator ATTACHES to a specific mesh
 * node so services can use SPACE on that node.
 *
 * <p>ADMIN-CAPABLE (route-guarded by {@link adminGuard}, NOT superadmin) — the deliberate
 * DIVERGENCE from the Device-Licenses console. The OWNERSHIP gating is enforced by the BFF:
 * an ADMIN may act ONLY on own-domain ADMIN-owned nodes (a SUPERADMIN-owned or cross-domain
 * node is a 403), SUPERADMIN is unrestricted. The list itself is BFF-scoped (a brand admin
 * sees only their brand's pools/assignments).
 *
 * <p>The view shows each pool with a CAPACITY BAR (committed vs reserved), a PROPAGATION
 * CHIP (pending/applied/failed/degraded reconcile state), and its active assignments; and
 * lets the operator ATTACH a pool to a node and ASSIGN a service to a pool. Residuals are
 * surfaced inline: a node-pinned PV has NO HA (data loss on disk loss), so the assign form
 * WARNS when a likely-stateful (database-shaped) service name is assigned to a pool — the
 * operator should scope node-pinned storage to REPLACEABLE data.
 */
@Component({
  selector: 'snap-storage-pools',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './storage-pools.component.html',
  styleUrl: './storage-pools.component.scss',
})
export class StoragePoolsComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly pools = signal<StoragePool[]>([]);
  readonly assignments = signal<ServiceAssignment[]>([]);
  /** Registered devices (attach targets) — own-domain admin-owned for an ADMIN. */
  readonly devices = signal<DeviceRegistration[]>([]);

  /** Attach-pool form state. */
  attachDeviceId = '';
  diskSerial = '';
  poolPath = '';
  reservedGiB = 100;
  exclusive = false;
  filesystem = 'ext4';
  readonly attachError = signal('');

  /** Assign-service form state. */
  assignPoolId = '';
  serviceName = '';
  pvcName = '';
  requestedGiB = 10;
  readonly assignError = signal('');

  async ngOnInit(): Promise<void> {
    const { pools, assignments } = await this.bff.storagePools();
    this.pools.set(pools);
    this.assignments.set(assignments);
    this.devices.set(await this.bff.devices());
    if (!this.attachDeviceId && this.devices().length) this.attachDeviceId = this.devices()[0].id;
    if (!this.assignPoolId && this.activePools().length) this.assignPoolId = this.activePools()[0].id;
  }

  /** Only ACTIVE pools may take a new assignment. */
  readonly activePools = computed(() => this.pools().filter((p) => p.state === 'active'));

  /** Active assignments grouped by pool id (for the per-pool list + the capacity sum). */
  assignmentsForPool(poolId: string): ServiceAssignment[] {
    return this.assignments().filter((a) => a.poolId === poolId && a.state === 'active');
  }

  /** Bytes committed on a pool = sum of its active assignments' requestedBytes. */
  committedBytes(poolId: string): number {
    return this.assignmentsForPool(poolId).reduce((sum, a) => sum + a.requestedBytes, 0);
  }

  /** Committed fraction (0..1) for the capacity bar. */
  committedFraction(pool: StoragePool): number {
    if (pool.reservedBytes <= 0) return 0;
    return Math.min(1, this.committedBytes(pool.id) / pool.reservedBytes);
  }

  /** Human-readable bytes (GiB-ish) for the capacity labels. */
  humanBytes(bytes: number): string {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  private gibToBytes(gib: number): number {
    return Math.round(gib * 1024 * 1024 * 1024);
  }

  /** Heuristic: a likely-stateful service name (a node-pinned PV with NO HA is a data-loss
   *  risk for it). Surfaced as a non-blocking WARNING on the assign form. A plain method
   *  (NOT a computed) because {@code serviceName} is an ngModel-bound plain property, not a
   *  signal — the template re-evaluates it each change-detection pass. */
  assignWarning(): string {
    const name = this.serviceName.trim().toLowerCase();
    if (!name) return '';
    const stateful = ['postgres', 'postgresql', 'mysql', 'mariadb', 'mongo', 'db', 'database', 'etcd'];
    if (stateful.some((s) => name.includes(s))) {
      return 'Node-pinned storage has NO HA — a disk loss loses this data. Prefer it only for '
        + 'REPLACEABLE data (caches, media, downloads), not a primary database.';
    }
    return '';
  }

  async attach(): Promise<void> {
    const diskSerial = this.diskSerial.trim();
    const poolPath = this.poolPath.trim();
    if (!this.attachDeviceId || !diskSerial || !poolPath || this.reservedGiB <= 0) {
      this.attachError.set('Pick a node and enter a disk serial, a node-local path, and a positive size.');
      return;
    }
    this.attachError.set('');
    try {
      await this.bff.attachPool(this.attachDeviceId, {
        diskSerial,
        poolPath,
        reservedBytes: this.gibToBytes(this.reservedGiB),
        exclusive: this.exclusive,
        filesystem: this.filesystem.trim() || null,
      });
      await this.reload();
      this.diskSerial = '';
      this.poolPath = '';
    } catch (e) {
      this.attachError.set((e as Error).message);
    }
  }

  async assign(): Promise<void> {
    const serviceName = this.serviceName.trim();
    const pvcName = this.pvcName.trim();
    if (!this.assignPoolId || !serviceName || !pvcName || this.requestedGiB <= 0) {
      this.assignError.set('Pick a pool and enter a service name, a PVC name, and a positive size.');
      return;
    }
    this.assignError.set('');
    try {
      await this.bff.assignService(this.assignPoolId, {
        serviceName,
        pvcName,
        requestedBytes: this.gibToBytes(this.requestedGiB),
      });
      await this.reload();
      this.serviceName = '';
      this.pvcName = '';
    } catch (e) {
      this.assignError.set((e as Error).message);
    }
  }

  async detach(poolId: string): Promise<void> {
    try {
      await this.bff.detachPool(poolId);
      await this.reload();
    } catch (e) {
      this.attachError.set((e as Error).message);
    }
  }

  async revoke(assignmentId: string): Promise<void> {
    try {
      await this.bff.revokeAssignment(assignmentId);
      await this.reload();
    } catch (e) {
      this.assignError.set((e as Error).message);
    }
  }

  private async reload(): Promise<void> {
    const { pools, assignments } = await this.bff.storagePools();
    this.pools.set(pools);
    this.assignments.set(assignments);
  }
}
