import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Terminal } from '@xterm/xterm';
import { BffService, DeviceRegistration } from '../bff.service';
import { SessionService } from '../session.service';

declare const __SNAP_BFF_URL__: string | undefined;

/**
 * The in-UI SSH TERMINAL (own repo: snapdragon-admin-ui). The admin front-end for the
 * desktop-governance SSH-terminal surface (admin-bff {@code DesktopSshTerminalController} at
 * {@code /bff/admin/desktop/ssh-terminal/sessions}). REUSES the workload-console
 * ({@code WorkloadTerminalComponent}) xterm.js bridge pattern exactly: the bearer + (when the
 * live WS lands) the session token ride query params on the WS handshake (a browser
 * {@code WebSocket} cannot set an Authorization header), output is written to the terminal, and
 * keystrokes/resizes are sent as {@code {"type":"stdin"|"resize",...}} frames.
 *
 * <h3>SHIPS DARK (admin-bff scaffold)</h3>
 * The admin-bff endpoint is currently a SCAFFOLD: it performs the REAL authorization (the same
 * own-domain device-ssh-license check as remote-install — a 403 on deny) but returns a
 * {@code {dark:true}} session descriptor rather than opening a live TTY (the live xterm.js WS
 * bridge reuses the workload-console TTY/SSE infra and lands in a follow-on increment). So
 * "Open terminal" here AUTHORIZES the session and, while the descriptor is dark, renders the
 * terminal pane greyed with helptext explaining the dark state. The instant the descriptor flips
 * {@code dark:false} (carrying WS handshake params), this component opens the live xterm.js
 * session — no further UI change needed.
 *
 * <h3>Gating (defence-in-depth — the BFF is authoritative)</h3>
 * The Open button is disabled + carries helptext when the selected device is superadmin-owned or
 * the acting admin holds no active device-ssh-license for it (presentation only); the BFF
 * re-enforces and a server 403 is surfaced verbatim.
 */
@Component({
  selector: 'snap-desktop-ssh-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './desktop-ssh-terminal.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopSshTerminalComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  @ViewChild('term', { static: false }) termRef?: ElementRef<HTMLDivElement>;

  readonly devices = signal<DeviceRegistration[]>([]);
  deviceId = '';

  readonly connected = signal(false);
  /** True when the BFF authorized the session but it SHIPS DARK (no live TTY yet). */
  readonly dark = signal(false);
  readonly darkNote = signal('');
  readonly statusMsg = signal('');
  readonly error = signal('');

  private term?: Terminal;
  private ws?: WebSocket;

  // The {@code deviceId}-dependent predicates are plain GETTERS (not computed) so they re-
  // evaluate against the live {@code [(ngModel)]} selection every change-detection pass; a
  // {@code computed} would not react to the plain {@code deviceId} field changing.
  private get operator(): string { return (this.session.session()?.id ?? '').toLowerCase(); }

  get selectedDevice(): DeviceRegistration | undefined {
    return this.devices().find((d) => d.id === this.deviceId);
  }

  hasLicense(): boolean {
    const d = this.selectedDevice;
    if (!d) return false;
    const op = this.operator;
    return d.licenses.some((l) =>
      l.state === 'active'
      && (l.operator ?? '').toLowerCase() === op
      && (l.scope_type === 'DEVICE' ? l.device_id === d.id : (l.target_domain ?? '') === d.domain));
  }

  superadminOwned(): boolean { return this.selectedDevice?.owner_type === 'SUPERADMIN'; }

  gateReason(): string {
    if (!this.deviceId) return 'Pick a device to open an SSH terminal on.';
    if (this.superadminOwned()) {
      return 'This device is superadmin-owned — the in-UI SSH terminal is not available on it.';
    }
    if (!this.hasLicense()) {
      return 'You hold no active device-SSH license for this device — the SSH terminal is blocked.';
    }
    return '';
  }

  canOpen(): boolean { return this.gateReason() === ''; }

  async ngOnInit(): Promise<void> {
    this.devices.set(await this.bff.devices());
    if (!this.deviceId && this.devices().length) this.deviceId = this.devices()[0].id;
  }

  ngAfterViewInit(): void {
    // The terminal is created lazily on open so the element is laid out and we avoid touching
    // xterm during SSR / headless test bootstrap.
  }

  /** Authorize + open an SSH-terminal session. While the admin-bff descriptor is dark, surface
   *  the dark state (no live TTY); when it flips live, open the xterm.js WS. */
  async open(): Promise<void> {
    this.error.set('');
    this.dark.set(false);
    this.darkNote.set('');
    if (!this.canOpen()) {
      this.error.set(this.gateReason());
      return;
    }
    let descriptor: { deviceId: string; dark: boolean; note?: string | null };
    try {
      descriptor = await this.bff.desktopOpenSshSession(this.deviceId);
    } catch (e) {
      // 403 on a license / own-domain / superadmin-owned denial.
      this.error.set('SSH terminal denied: ' + (e as Error).message);
      return;
    }
    if (descriptor.dark) {
      this.dark.set(true);
      this.darkNote.set(descriptor.note
        ?? 'The interactive SSH-via-UI session is authorized but ships dark — the live terminal '
          + 'bridge is a follow-on increment.');
      this.statusMsg.set('Session authorized (ships dark — no live terminal yet).');
      return;
    }
    this.openLiveTerminal(descriptor.deviceId);
  }

  /**
   * Open the live xterm.js session over the WS bridge — REUSES the workload-console terminal
   * handshake (bearer rides a query param; output → terminal; keystrokes/resizes → frames). This
   * path is dormant until the admin-bff descriptor flips {@code dark:false}.
   */
  private openLiveTerminal(deviceId: string): void {
    const bffBase = (typeof __SNAP_BFF_URL__ !== 'undefined' && __SNAP_BFF_URL__) ? __SNAP_BFF_URL__ : '';
    const wsBase = this.toWsBase(bffBase);
    const token = this.session.session()?.bffToken ?? '';
    const q = new URLSearchParams({ access_token: token, deviceId });
    const url = `${wsBase}/bff/admin/desktop/ssh-terminal/ws?${q}`;

    this.term = new Terminal({ convertEol: true, cursorBlink: true });
    if (this.termRef) this.term.open(this.termRef.nativeElement);

    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected.set(true);
      this.statusMsg.set('SSH terminal connected.');
      this.term?.onData((d) => ws.send(JSON.stringify({ type: 'stdin', data: d })));
      this.term?.onResize(({ cols, rows }) => ws.send(JSON.stringify({ type: 'resize', cols, rows })));
    };
    ws.onmessage = (ev) => this.term?.write(typeof ev.data === 'string' ? ev.data : '');
    ws.onerror = () => this.error.set('SSH terminal connection error.');
    ws.onclose = () => {
      this.connected.set(false);
      this.statusMsg.set('SSH terminal closed.');
    };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = undefined;
    this.connected.set(false);
  }

  private toWsBase(httpBase: string): string {
    if (!httpBase) {
      const loc = typeof window !== 'undefined' ? window.location : undefined;
      const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
      return loc ? `${proto}//${loc.host}` : 'ws://localhost';
    }
    return httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }

  deviceLabel(d: DeviceRegistration): string {
    return `${d.hostname} (${d.domain}${d.owner_type === 'SUPERADMIN' ? ', superadmin-owned' : ''})`;
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.term?.dispose();
  }
}
