import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, PendingNode, RegisterDeviceInput } from './bff.service';

/**
 * Superadmin "Pending devices" pick-list (machine_key_fp AUTO-CAPTURE). The MVP surface
 * over the device-license registry's PENDING flow: every headscale-ENROLLED node
 * LEFT-JOINed with the registry, so a superadmin can pick an UNREGISTERED node and assign
 * its owner_type / domain / image_type / physical-owner / mesh. SUPERADMIN-only
 * (route-guarded by {@link superadminGuard}); a non-superadmin is bounced to /login.
 *
 * <h3>The fingerprint is an OPAQUE TOKEN — never typed, edited, or normalised</h3>
 * Headscale is the trust gate (it MINTS the machine keys). The {@code machineKeyFp} is
 * captured from headscale and carried through this UI VERBATIM: it is shown read-only, it
 * is NEVER an editable input, and the register call passes it back byte-for-byte (the BFF
 * re-validates it against headscale). Any format drift would fail-closed-deny that node
 * everywhere downstream, so the UI must not touch it.
 *
 * <h3>⚠ ADVISORY (ships dark)</h3>
 * With the headscale seam off (admin-bff default), {@link BffService#pendingNodes} returns
 * the registry-only view (no enrolled-but-unregistered candidates), so the pick-list simply
 * shows the registered nodes and nothing to assign — correct fail-soft until a live control
 * node is wired and the BFF flag flipped.
 */
@Component({
  selector: 'hug-device-pending',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './device-pending.component.html',
  styleUrl: './device-pending.component.scss',
})
export class DevicePendingComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly nodes = signal<PendingNode[]>([]);

  /** The selected pending node's OPAQUE fingerprint (the pick-list selection key). It is
   *  NEVER a typed/edited value — only chosen from {@link nodes}. */
  selectedFp = '';

  /** Assignment form state (everything the superadmin assigns to the picked node). */
  ownerType: 'ADMIN' | 'SUPERADMIN' = 'ADMIN';
  imageType: 'primary' | 'mesh-extension' | 'client' = 'mesh-extension';
  domain = '';
  physicalOwner = '';
  meshId = '';

  /** Inline validation surfaced in a role=alert live region. Empty = valid. */
  readonly formError = signal('');
  /** A success line after a register (also role=status). Empty = none. */
  readonly formNotice = signal('');

  async ngOnInit(): Promise<void> {
    this.nodes.set(await this.bff.pendingNodes());
    this.preselectFirstUnregistered();
  }

  /** Only UNREGISTERED nodes are assignable (a registered fp already has a residency). */
  readonly pendingOnly = () => this.nodes().filter((n) => !n.registered);

  /** The currently-selected pending node (for the read-only fp + mesh hint display). */
  selected(): PendingNode | undefined {
    return this.nodes().find((n) => n.machineKeyFp === this.selectedFp);
  }

  async register(): Promise<void> {
    this.formNotice.set('');
    const node = this.selected();
    if (!node) {
      this.formError.set('Pick an enrolled node to assign.');
      return;
    }
    if (node.registered) {
      this.formError.set('That node is already registered.');
      return;
    }
    const physicalOwner = this.physicalOwner.trim().toLowerCase();
    const domain = this.domain.trim().toLowerCase();
    const meshId = (this.meshId || node.meshId || '').trim();
    if (!physicalOwner || !domain || !meshId) {
      this.formError.set('Enter a physical owner, a domain (residency) and a mesh id.');
      return;
    }
    this.formError.set('');
    const input: RegisterDeviceInput = {
      // OPAQUE: the fp comes straight from the picked node, NEVER from a text field.
      machineKeyFp: node.machineKeyFp,
      hostname: (node.hostname || node.machineKeyFp).trim(),
      ownerType: this.ownerType,
      imageType: this.imageType,
      physicalOwner,
      domain,
      meshId,
      tailnetId: node.user ?? undefined,
    };
    try {
      const saved = await this.bff.registerFromPending(input);
      this.formNotice.set(`Registered ${saved.hostname} in ${saved.domain}.`);
      // Refresh the list (the just-registered fp now shows registered).
      this.nodes.set(await this.bff.pendingNodes());
      this.physicalOwner = '';
      this.preselectFirstUnregistered();
    } catch (e) {
      this.formError.set((e as Error)?.message || 'Registration failed.');
    }
  }

  private preselectFirstUnregistered(): void {
    const first = this.pendingOnly()[0];
    this.selectedFp = first ? first.machineKeyFp : '';
    if (first) {
      this.meshId = first.meshId ?? '';
    }
  }
}
