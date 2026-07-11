import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, ViewEncapsulation, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Terminal } from '@xterm/xterm';
import { BffService, DeviceRegistration, DesktopSshSession } from '../bff.service';
import { SessionService } from '../session.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from '../mfa/step-up-error';

/**
 * The in-UI SSH TERMINAL (own repo: snapdragon-admin-ui). The admin front-end for the
 * desktop-governance SSH-terminal surface. The PRE-HANDSHAKE descriptor is fetched from
 * {@code POST /bff/admin/desktop/ssh-terminal/sessions?deviceId=...}; the live TTY then opens to
 * the descriptor's {@code wsPath} ({@code /bff/admin/device-terminal/{deviceId}} — deviceId in the
 * PATH). REUSES the workload-console ({@code WorkloadTerminalComponent}) xterm.js bridge pattern,
 * with one deliberate difference dictated by the device-terminal WS handler contract: the step-up
 * token is carried via the {@code Sec-WebSocket-Protocol} subprotocol
 * ({@code snapdragon.device-terminal.stepup.<TOKEN>}) rather than a {@code ?stepUp=} query, and
 * there is NO {@code ?access_token=} query — the bearer rides the gateway-gated {@code /bff/admin/**}
 * path. Output is written to the terminal; keystrokes/resizes are {@code {"type":"stdin"|"resize"}}
 * frames.
 *
 * <h3>SHIPS DARK (app.device-terminal.enabled, default false)</h3>
 * The admin-bff performs the REAL authorization (the same own-domain device-ssh-license check as
 * remote-install — a generic 403 on deny) but, while the flag is off, the descriptor reports
 * {@code dark:true} and NO socket is opened: "Open terminal" AUTHORIZES the session and renders
 * the terminal pane greyed with a {@code role=status} dark note. The instant the descriptor flips
 * {@code dark:false}, this component mints a desktop step-up and opens the live xterm.js session
 * to {@code wsPath} — no further UI change needed. The corrected path/step-up handshake is testable
 * while dark against a fake live descriptor; the real round-trip is held-until-live.
 *
 * <h3>Gating (defence-in-depth — the BFF is authoritative)</h3>
 * The Open button is disabled + carries helptext when the selected device is superadmin-owned or
 * the acting admin holds no active device-ssh-license for it (presentation only); the BFF
 * re-enforces and a server 403 is surfaced verbatim.
 */
@Component({
  selector: 'snap-desktop-ssh-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './desktop-ssh-terminal.component.html',
  // Same federation-safe xterm CSS loading as WorkloadTerminalComponent (see its styleUrls
  // comment) — xterm paints its own DOM outside Angular's renderer, so the stylesheet has to
  // ship unscoped and bundled into THIS component's own chunk, not a repo-local angular.json
  // global style the host's native-federation mount never links.
  styleUrls: [
    '../../../node_modules/@xterm/xterm/css/xterm.css',
    './desktop-governance.component.scss',
  ],
  encapsulation: ViewEncapsulation.None,
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

  /** A pending step-up challenge for the live-terminal step-up mint, or null when none is in
   *  flight. The WS denial itself is a bodyless POLICY_VIOLATION close, so the dialog is hooked on
   *  the {@link BffService#desktopStepUp} MINT 403 that names step-up; `retry` re-opens the live
   *  terminal once the inline {@link MfaStepUpDialogComponent} reports the challenge satisfied. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

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
    let descriptor: DesktopSshSession;
    try {
      descriptor = await this.bff.desktopOpenSshSession(this.deviceId);
    } catch (e) {
      // A device-targeting denial (license / own-domain / superadmin-owned / unresolvable) is
      // collapsed to ONE generic message by the BFF — surfaced verbatim.
      this.error.set('SSH terminal denied: ' + (e as Error).message);
      return;
    }
    if (descriptor.dark) {
      this.dark.set(true);
      this.darkNote.set(descriptor.note
        ?? 'The interactive SSH-via-UI session is authorized but ships dark — the live terminal '
          + 'bridge stays dormant until app.device-terminal.enabled is on.');
      this.statusMsg.set('Session authorized (ships dark — no live terminal yet).');
      return; // ships dark: open NO socket.
    }
    // LIVE: the descriptor carries the real WS path; mint a step-up then open the bridge.
    await this.openLiveTerminal(descriptor);
  }

  /**
   * Open the live xterm.js session over the WS bridge. The handshake targets the descriptor's
   * {@code wsPath} ({@code /bff/admin/device-terminal/{deviceId}} — deviceId in the PATH, NOT a
   * query). A browser {@code WebSocket} cannot set headers, so:
   *  - the bearer rides the gateway-gated {@code /bff/admin/**} path (no access_token query);
   *  - the step-up token is smuggled via the {@code Sec-WebSocket-Protocol} subprotocol as
   *    {@code snapdragon.device-terminal.stepup.<TOKEN>} alongside the selector subprotocol
   *    {@code snapdragon.device-terminal} (NOT a {@code ?stepUp=} query — token-in-URL leak).
   * Dormant until the descriptor flips {@code dark:false}.
   */
  private async openLiveTerminal(descriptor: DesktopSshSession): Promise<void> {
    let stepUp: string;
    try {
      stepUp = (await this.bff.desktopStepUp(this.operator)).stepUpToken;
    } catch (e) {
      // A "requires step-up" mint 403 (fresh MFA re-auth needed) opens the inline dialog and the
      // live terminal is re-opened on success; any other mint failure stays a verbatim error.
      if (isStepUpRequiredError(e)) {
        this.offerStepUp('Opening this SSH terminal', () => this.openLiveTerminal(descriptor));
        return;
      }
      this.error.set('Step-up required: ' + (e as Error).message);
      return;
    }

    const bffBase = (typeof __SNAP_BFF_URL__ !== 'undefined' && __SNAP_BFF_URL__) ? __SNAP_BFF_URL__ : '';
    const wsBase = this.toWsBase(bffBase);
    const path = descriptor.wsPath || `/bff/admin/device-terminal/${encodeURIComponent(descriptor.deviceId)}`;
    const q = new URLSearchParams({ cols: '80', rows: '24' });
    const url = `${wsBase}${path}?${q}`;
    const subprotocols = ['snapdragon.device-terminal', `snapdragon.device-terminal.stepup.${stepUp}`];

    this.term = new Terminal({ convertEol: true, cursorBlink: true });
    if (this.termRef) this.term.open(this.termRef.nativeElement);

    const ws = this.createSocket(url, subprotocols);
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

  /** Offer the inline MFA step-up dialog for a live-terminal step-up mint that just 403'd with the
   *  "requires step-up" contract. `retry` is invoked once the dialog reports success. */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry opening the live terminal it was blocking
   *  (the BFF now mints against a fresh MFA stamp on this session; no token is needed here). */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  private toWsBase(httpBase: string): string {
    if (!httpBase) {
      const loc = typeof window !== 'undefined' ? window.location : undefined;
      const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
      return loc ? `${proto}//${loc.host}` : 'ws://localhost';
    }
    return httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }

  /** The {@code (url, subprotocols)} of the LAST WS the component opened — a test seam so specs
   *  can assert the corrected handshake shape (deviceId in PATH, step-up via subprotocol, NO
   *  access_token query) without standing up a real socket server. */
  lastSocketArgs: { url: string; protocols: string[] } | null = null;

  /** Construct the WebSocket. Isolated so tests can record/stub the handshake shape (the live
   *  round-trip is held-until-live behind app.device-terminal.enabled + a reachable device). */
  protected createSocket(url: string, protocols: string[]): WebSocket {
    this.lastSocketArgs = { url, protocols };
    return new WebSocket(url, protocols);
  }

  deviceLabel(d: DeviceRegistration): string {
    return `${d.hostname} (${d.domain}${d.owner_type === 'SUPERADMIN' ? ', superadmin-owned' : ''})`;
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.term?.dispose();
  }
}
