import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  NodeRadio,
  DeviceRegistration,
  AttachRadioBody,
} from './bff.service';

/**
 * Admin "Device radios" console (own repo: hugmesh-admin-ui). The MVP surface over the
 * NODE RADIO control plane — a Meshtastic LoRa radio an operator ATTACHES to a specific
 * mesh node so the meshbridge optional service (the mesh↔Matrix bridge) can reach the LoRa
 * mesh through that node.
 *
 * <p>ADMIN-CAPABLE (NOT superadmin) — the same deliberate DIVERGENCE the Node-storage
 * console carries. This route carries no additional client-side `canActivate` guard beyond
 * the host shell's baseline Casdoor-admin-role gate on `/admin/**` ({@link adminGuard} itself
 * is not currently wired into any route — see its own TODO). The OWNERSHIP gating is enforced
 * by the BFF: an ADMIN may act ONLY on own-domain ADMIN-owned nodes (a SUPERADMIN-owned or
 * cross-domain node is a 403), SUPERADMIN is unrestricted. The list itself is BFF-scoped
 * (a brand admin sees only their brand's radios).
 *
 * <p>The view shows each radio with its TRANSPORT summary (serial path / host:port /
 * broker+topic) and a PROPAGATION CHIP (pending/applied/failed/degraded reconcile state),
 * and lets the operator ATTACH a radio to a node over one of THREE transports — 'USB
 * serial' (a serial device path on that node), 'LoRa-WiFi (TCP)' (host + port, Meshtastic
 * TCP API default 4403) or 'LoRaWAN / WAN mesh (MQTT)' (broker host + port default 1883 +
 * topic root + channel name + optional !hex8 gateway node id) — and DETACH one. The form
 * shows exactly the fields of the selected transport (a mixed shape is a BFF 422; the
 * client validates the required set before any call).
 */
@Component({
  selector: 'hug-device-radios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './device-radios.component.html',
  styleUrl: './device-radios.component.scss',
})
export class DeviceRadiosComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly radios = signal<NodeRadio[]>([]);
  /** Registered devices visible to this session — own-domain admin-owned nodes for ADMIN; all nodes for SUPERADMIN. */
  readonly devices = signal<DeviceRegistration[]>([]);

  // ── Attach-radio form fields (ngModel-bound plain properties, not signals) ──
  /** The device ID of the node the radio is being attached to. */
  attachDeviceId = '';
  /** How the node reaches the radio: USB serial, LoRa-WiFi TCP, or a WAN mesh via MQTT. */
  transport: 'serial' | 'tcp' | 'mqtt' = 'serial';
  /** serial only: the node-local serial device path (e.g. `/dev/ttyUSB0`). */
  serialPath = '';
  /** tcp + mqtt: the radio's / broker's hostname or IPv4. */
  host = '';
  /** tcp + mqtt: the TCP port (Meshtastic API 4403 / MQTT broker 1883). */
  port = 4403;
  /** mqtt only: the broker topic root the mesh publishes under (e.g. `msh/US`). */
  topicRoot = '';
  /** mqtt only: the Meshtastic channel name the JSON integration subscribes on. */
  channelName = '';
  /** mqtt only (optional): the `!hex8` mesh gateway node id for downlink attribution. */
  gatewayNodeId = '';
  /** The stable bridge-facing radio identity (unique per node while active). */
  radioId = '';
  /** The Meshtastic mesh channel index (0..7) the bridge binds this radio on. */
  meshChannel = 0;
  /** Error message from the last attach/detach attempt. Displayed in an aria-live region. */
  readonly attachError = signal('');

  async ngOnInit(): Promise<void> {
    // Load the radios, then the device list (sequentially).
    this.radios.set(await this.bff.radios());
    this.devices.set(await this.bff.devices());
    // Pre-select the first device so the form is usable immediately.
    if (!this.attachDeviceId && this.devices().length) this.attachDeviceId = this.devices()[0].id;
  }

  /**
   * Reset the per-transport fields when the transport select changes, and pre-fill the
   * conventional default port (Meshtastic TCP API 4403 / MQTT broker 1883) so the form
   * always shows exactly the selected transport's shape — a mixed shape is a BFF 422.
   */
  onTransportChange(): void {
    this.serialPath = '';
    this.host = '';
    this.topicRoot = '';
    this.channelName = '';
    this.gatewayNodeId = '';
    this.port = this.transport === 'mqtt' ? 1883 : 4403;
    this.attachError.set('');
  }

  /**
   * One-line transport summary for a radio row (what the bridge will open).
   *
   * @param r - The radio to summarise.
   */
  transportSummary(r: NodeRadio): string {
    if (r.transport === 'serial') return r.serialPath ?? '';
    if (r.transport === 'tcp') return `${r.host}:${r.port}`;
    return `${r.host}:${r.port} · ${r.topicRoot}/${r.channelName}`
      + (r.gatewayNodeId ? ` · gw ${r.gatewayNodeId}` : '');
  }

  /**
   * Attach a radio to a node. Validates the SELECTED transport's required fields before
   * calling the BFF (`POST /bff/admin/device-radios/{deviceId}/radios`) — serial needs a
   * `/dev/...` path; tcp needs host+port; mqtt needs host+port+topic root+channel name.
   * Reloads the radio list on success and clears the volatile fields (radio id + the
   * transport inputs), leaving the device selector + transport in place.
   *
   * @throws BFF error message surfaced into `attachError` signal.
   */
  async attach(): Promise<void> {
    const radioId = this.radioId.trim();
    if (!this.attachDeviceId || !radioId || this.meshChannel < 0 || this.meshChannel > 7) {
      this.attachError.set('Pick a node and enter a radio id and a mesh channel 0..7.');
      return;
    }
    const body = this.buildBody(radioId);
    if (!body) return;   // buildBody surfaced the per-transport error
    this.attachError.set('');
    try {
      await this.bff.attachRadio(this.attachDeviceId, body);
      this.radios.set(await this.bff.radios());
      // Clear the one-shot fields; leave device + transport intact for a multi-radio flow.
      this.radioId = '';
      this.serialPath = '';
      this.host = '';
      this.topicRoot = '';
      this.channelName = '';
      this.gatewayNodeId = '';
    } catch (e) {
      this.attachError.set((e as Error).message);
    }
  }

  /**
   * Build the per-transport attach body, surfacing a validation error (and returning
   * null) when the SELECTED transport's required fields are missing. Only the selected
   * transport's fields ride the payload — the BFF rejects a mixed shape (422).
   *
   * @param radioId - The trimmed bridge-facing radio id.
   */
  private buildBody(radioId: string): AttachRadioBody | null {
    const base = { radioId, meshChannel: this.meshChannel };
    if (this.transport === 'serial') {
      const serialPath = this.serialPath.trim();
      if (!serialPath.startsWith('/dev/')) {
        this.attachError.set('Enter the node-local serial device path (an absolute /dev/… path).');
        return null;
      }
      return { transport: 'serial', serialPath, ...base };
    }
    const host = this.host.trim();
    if (!host || this.port < 1 || this.port > 65535) {
      this.attachError.set('Enter the radio/broker host and a port 1..65535.');
      return null;
    }
    if (this.transport === 'tcp') {
      return { transport: 'tcp', host, port: this.port, ...base };
    }
    const topicRoot = this.topicRoot.trim();
    const channelName = this.channelName.trim();
    if (!topicRoot || !channelName) {
      this.attachError.set('MQTT needs a topic root (e.g. msh/US) and a channel name.');
      return null;
    }
    const gatewayNodeId = this.gatewayNodeId.trim();
    return {
      transport: 'mqtt', host, port: this.port, topicRoot, channelName,
      ...(gatewayNodeId ? { gatewayNodeId } : {}), ...base,
    };
  }

  /**
   * Detach a radio from its node (`DELETE /bff/admin/device-radios/radios/{id}`).
   * A CAS state flip on the BFF — the row is audited, never deleted.
   *
   * @param id - The radio attachment row to detach.
   */
  async detach(id: string): Promise<void> {
    try {
      await this.bff.detachRadio(id);
      this.radios.set(await this.bff.radios());
    } catch (e) {
      this.attachError.set((e as Error).message);
    }
  }
}
