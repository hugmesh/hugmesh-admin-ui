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
 * Admin "Node storage" console (own repo: hugmesh-admin-ui). The MVP surface over the
 * NODE STORAGE control plane — ADDITIONAL storage an operator ATTACHES to a specific mesh
 * node so services can use SPACE on that node.
 *
 * <p>ADMIN-CAPABLE (NOT superadmin) — the deliberate DIVERGENCE from the Device-Licenses
 * console. The route carries only the baseline {@link adminGuard} (the same `admin`-role
 * predicate the host shell already applies to its `/admin` mount) — unlike device-licenses/
 * device-pending/egress-vpn/superadmin-domains, which carry {@link superadminGuard}. The OWNERSHIP
 * gating is enforced by the BFF:
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
  selector: 'hug-storage-pools',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './storage-pools.component.html',
  styleUrl: './storage-pools.component.scss',
})
export class StoragePoolsComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly pools = signal<StoragePool[]>([]);
  readonly assignments = signal<ServiceAssignment[]>([]);
  /** Registered devices visible to this session — own-domain admin-owned nodes for ADMIN; all nodes for SUPERADMIN. */
  readonly devices = signal<DeviceRegistration[]>([]);

  // ── Attach-pool form fields (ngModel-bound plain properties, not signals) ──
  /** The device ID of the node the pool is being attached to. */
  attachDeviceId = '';
  /** Hardware serial of the disk to register (from `lsblk -o SERIAL`). */
  diskSerial = '';
  /** Absolute path on the node where the pool is mounted (e.g. `/mnt/data`). */
  poolPath = '';
  /** Reserved capacity in GiB (converted to bytes before sending to BFF). */
  reservedGiB = 100;
  /** Whether this pool is exclusive to a single service assignment at a time. */
  exclusive = false;
  /** Filesystem type hint (e.g. `ext4`, `xfs`). Informational — the pool is assumed formatted. */
  filesystem = 'ext4';
  /** Error message from the last attach/detach attempt. Displayed in an aria-live region. */
  readonly attachError = signal('');

  // ── Assign-service form fields (ngModel-bound plain properties) ──
  /** The pool ID to assign a service to (pre-filled with the first active pool on load). */
  assignPoolId = '';
  /** The Kubernetes service name requesting this storage (used for the HA warning heuristic). */
  serviceName = '';
  /** The PersistentVolumeClaim name the service will bind. */
  pvcName = '';
  /** Requested allocation in GiB (converted to bytes before sending to BFF). */
  requestedGiB = 10;
  /** Error message from the last assign/revoke attempt. Displayed in an aria-live region. */
  readonly assignError = signal('');

  async ngOnInit(): Promise<void> {
    // Load the pools + assignments, then the device list (sequentially).
    const { pools, assignments } = await this.bff.storagePools();
    this.pools.set(pools);
    this.assignments.set(assignments);
    this.devices.set(await this.bff.devices());
    // Pre-select the first device and the first active pool so the form is usable immediately.
    if (!this.attachDeviceId && this.devices().length) this.attachDeviceId = this.devices()[0].id;
    if (!this.assignPoolId && this.activePools().length) this.assignPoolId = this.activePools()[0].id;
  }

  /**
   * Only `active` pools may accept a new assignment. Pools in `pending`, `failed` or
   * `degraded` reconcile state are filtered out so the assign-form dropdown stays safe.
   */
  readonly activePools = computed(() => this.pools().filter((p) => p.state === 'active'));

  /**
   * Return the currently-active assignments for a given pool (for the per-pool capacity
   * summary and the assignment list in the UI).
   *
   * @param poolId - The pool to filter assignments for.
   */
  assignmentsForPool(poolId: string): ServiceAssignment[] {
    return this.assignments().filter((a) => a.poolId === poolId && a.state === 'active');
  }

  /**
   * Total bytes committed on a pool — the sum of all active assignments' `requestedBytes`.
   * Used to compute the capacity bar fraction.
   *
   * @param poolId - The pool to sum.
   */
  committedBytes(poolId: string): number {
    return this.assignmentsForPool(poolId).reduce((sum, a) => sum + a.requestedBytes, 0);
  }

  /**
   * Fraction of reserved capacity that is committed (0..1, clamped at 1). Used as the
   * `width` percentage in the capacity progress bar.
   *
   * @param pool - The pool to compute the fraction for.
   * @returns A value in [0, 1]; 0 when the pool has no reserved capacity.
   */
  committedFraction(pool: StoragePool): number {
    if (pool.reservedBytes <= 0) return 0;
    return Math.min(1, this.committedBytes(pool.id) / pool.reservedBytes);
  }

  /**
   * Format a byte count as a human-readable string using the largest binary unit
   * that keeps the value ≥ 1 (e.g. `2.5 GiB`, `512 MiB`, `1.0 TiB`).
   *
   * @param bytes - The raw byte count to format.
   * @returns A string with the value and the appropriate binary unit.
   */
  humanBytes(bytes: number): string {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let v = bytes;
    let i = 0;
    // Step up units while the value is ≥ 1024 and a larger unit exists.
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    // Use one decimal place for values < 100, except for whole-byte values.
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /**
   * Convert a GiB value (from the form input) to bytes for the BFF payload.
   *
   * @param gib - GiB value to convert.
   * @returns The equivalent byte count, rounded to the nearest integer.
   */
  private gibToBytes(gib: number): number {
    return Math.round(gib * 1024 * 1024 * 1024);
  }

  /**
   * Heuristic warning for assigning a likely-stateful service to a node-pinned pool.
   *
   * A node-pinned PV has **no HA** — a disk loss means data loss. This method checks
   * the service name for database-shaped keywords and returns a non-blocking warning
   * string when they match, urging the operator to use node-pinned storage only for
   * REPLACEABLE data (caches, media, downloads).
   *
   * **Why a plain getter, not a `computed()`?** `serviceName` is an ngModel-bound plain
   * property (not a signal). Angular's change-detection re-evaluates this method on each
   * CD pass, which is correct for plain-property bindings. Wrapping it in `computed()`
   * would NOT track the plain property and would silently return a stale value.
   *
   * @returns A warning string if the name looks stateful, or `''` if it looks safe.
   */
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

  /**
   * Attach a new storage pool to a node. Validates required fields before calling the BFF
   * (`POST /bff/admin/node-storage/{deviceId}/pools`). Reloads the pool list on success
   * and clears the volatile form fields (serial + path), leaving the device selector in place.
   *
   * @throws BFF error message surfaced into `attachError` signal.
   */
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
        // Convert GiB to bytes for the BFF payload.
        reservedBytes: this.gibToBytes(this.reservedGiB),
        exclusive: this.exclusive,
        filesystem: this.filesystem.trim() || null,
      });
      await this.reload();
      // Clear the one-shot fields; leave device + size intact for a multi-disk attach flow.
      this.diskSerial = '';
      this.poolPath = '';
    } catch (e) {
      this.attachError.set((e as Error).message);
    }
  }

  /**
   * Assign a service to an active storage pool (`POST /bff/admin/node-storage/pools/{poolId}/assignments`).
   * Validates required fields, converts GiB to bytes, reloads on success, and clears
   * the service name and PVC name (leaving the pool selector in place for bulk assignment).
   *
   * @throws BFF error message surfaced into `assignError` signal.
   */
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

  /**
   * Detach an existing pool from its node (`DELETE /bff/admin/node-storage/pools/{poolId}`).
   * Only callable when the pool has no active assignments (the BFF enforces this).
   *
   * @param poolId - The pool to detach.
   */
  async detach(poolId: string): Promise<void> {
    try {
      await this.bff.detachPool(poolId);
      await this.reload();
    } catch (e) {
      this.attachError.set((e as Error).message);
    }
  }

  /**
   * Revoke a service assignment from a pool (`DELETE /bff/admin/node-storage/assignments/{id}`).
   * The PVC affinity is removed; the scheduler may then bind the PVC elsewhere.
   *
   * @param assignmentId - The assignment row to revoke.
   */
  async revoke(assignmentId: string): Promise<void> {
    try {
      await this.bff.revokeAssignment(assignmentId);
      await this.reload();
    } catch (e) {
      this.assignError.set((e as Error).message);
    }
  }

  /** Re-fetch pools and assignments from the BFF after any mutation. */
  private async reload(): Promise<void> {
    const { pools, assignments } = await this.bff.storagePools();
    this.pools.set(pools);
    this.assignments.set(assignments);
  }
}
