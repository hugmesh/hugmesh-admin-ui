import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, ViewEncapsulation, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Terminal } from '@xterm/xterm';
import { BffService } from '../bff.service';

/**
 * SUPERADMIN interactive TTY terminal (DECISION 1 — full exec -it parity over xterm.js). The
 * handshake opens a WebSocket to {@code /bff/superadmin/workloads/exec-tty/{ns}/{pod}}; the
 * upgrade GET matches the {@code /bff/superadmin/workloads/**} prefix so it is gated by BOTH
 * Spring Security ({@code hasRole('SUPERADMIN')}) AND the BFF's central authz WebFilter
 * (DANGEROUS tier: dangerous-tier kill + step-up + device/SSH-license + namespace allowlist).
 * A browser {@code WebSocket} cannot set an Authorization header; the same-origin upgrade GET
 * carries the HttpOnly {@code bff_} cookie automatically (the gateway turns it into the bearer
 * server-side), and only the step-up token rides a query param on the handshake (the gateway/BFF
 * authenticate the upgrade from the cookie + step-up — same posture as other tailnet-only
 * superadmin WS surfaces; the browser never holds an admin bearer).
 *
 * <p>Protocol (xterm attach-addon style): inbound container output arrives as text frames and
 * is written to the terminal; keystrokes/resizes are sent as
 * {@code {"type":"stdin","data":...}} / {@code {"type":"resize","cols","rows"}}. The server
 * appends every chunk to a tamper-evident signed transcript and force-reschedules the pod
 * after the session closes (the detection-gap quarantine).
 */
@Component({
  selector: 'hug-workload-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workload-terminal.component.html',
  // xterm.js paints its own DOM (.xterm, .xterm-viewport, ...) directly into the #term div
  // OUTSIDE Angular's template/renderer, so those nodes never carry Angular's emulated-
  // encapsulation content attribute and Angular-scoped rules would never match them. Loading
  // xterm's stylesheet as a component styleUrl (rather than a repo-local angular.json global
  // style) means it ships bundled INSIDE this component's own JS chunk, so it's present
  // whether admin-ui is served standalone (dev) or mounted by the hugmesh.net host as a
  // native-federation remote (loadRemoteModule only pulls the remote's exposed JS — it never
  // links a remote's separate global stylesheet, which is the federation-safety gap this fixes;
  // see federation.config.js's @xterm/xterm extraSkip note for the sibling federation quirk).
  styleUrls: [
    '../../../node_modules/@xterm/xterm/css/xterm.css',
    './workload-console.component.scss',
  ],
  encapsulation: ViewEncapsulation.None,
})
export class WorkloadTerminalComponent implements AfterViewInit, OnDestroy {
  private readonly bff = inject(BffService);

  @ViewChild('term', { static: false }) termRef?: ElementRef<HTMLDivElement>;

  /** The Kubernetes namespace of the target pod (defaults to the primary app namespace). */
  namespace = 'hugmesh-backend';
  /** The pod name to exec into (must be running, in the accessible namespace). */
  pod = '';
  /** Optional container name within the pod (omit to use the first container). */
  container = '';
  /** The command to spawn inside the container (defaults to `/bin/sh`). */
  command = '/bin/sh';

  /** True while the WebSocket is open and the TTY is interactive. */
  readonly connected = signal(false);
  /** Status message announced in an aria-live region (connecting / connected / closed). */
  readonly statusMsg = signal('');
  /** Error message from the connect or step-up flow. Displayed in an aria-live region. */
  readonly error = signal('');

  /** The xterm.js terminal instance (created lazily on connect). */
  private term?: Terminal;
  /** The WebSocket backing the TTY session. */
  private ws?: WebSocket;

  ngAfterViewInit(): void {
    // The terminal is created lazily on connect so the element is laid out + we avoid
    // touching xterm during SSR/headless test bootstrap.
  }

  /**
   * Mint a fresh DANGEROUS-tier step-up token, then open the TTY WebSocket to the BFF.
   *
   * Flow:
   * 1. Call `BffService.workloadStepUp()` to get a short-TTL step-up token.
   * 2. Build the WS URL with both the bearer token and the step-up token in query params
   *    (WebSocket API cannot set headers, so tokens ride the URL — same posture as other
   *    Tailnet-only WS surfaces).
   * 3. Open the terminal, connect the WebSocket, wire `onData` → stdin and `onResize` → resize frames.
   *
   * @throws Error shown in the `error` signal when the step-up call fails.
   */
  async connect(): Promise<void> {
    this.error.set('');
    if (!this.pod.trim()) {
      this.error.set('Enter a pod name.');
      return;
    }
    let stepUp: string;
    try {
      stepUp = (await this.bff.workloadStepUp()).stepUpToken;
    } catch (e) {
      this.error.set('Step-up required: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }

    const bffBase = (typeof __HUG_BFF_URL__ !== 'undefined' && __HUG_BFF_URL__) ? __HUG_BFF_URL__ : '';
    const wsBase = this.toWsBase(bffBase);
    // The same-origin WS upgrade carries the HttpOnly bff_ cookie automatically (gateway turns
    // it into the bearer server-side); only the step-up token rides a query param.
    const q = new URLSearchParams({
      stepUp,
      command: this.command.trim() || '/bin/sh',
    });
    if (this.container.trim()) q.set('container', this.container.trim());
    const url = `${wsBase}/bff/superadmin/workloads/exec-tty/`
      + `${encodeURIComponent(this.namespace)}/${encodeURIComponent(this.pod.trim())}?${q}`;

    this.term = new Terminal({ convertEol: true, cursorBlink: true });
    if (this.termRef) this.term.open(this.termRef.nativeElement);

    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected.set(true);
      this.statusMsg.set('Terminal connected.');
      this.term?.onData((d) => ws.send(JSON.stringify({ type: 'stdin', data: d })));
      this.term?.onResize(({ cols, rows }) => ws.send(JSON.stringify({ type: 'resize', cols, rows })));
    };
    ws.onmessage = (ev) => this.term?.write(typeof ev.data === 'string' ? ev.data : '');
    ws.onerror = () => this.error.set('Terminal connection error.');
    ws.onclose = () => {
      this.connected.set(false);
      this.statusMsg.set('Terminal closed. The pod is force-rescheduled (quarantine).');
    };
  }

  /** Close the WebSocket and mark the terminal as disconnected. */
  disconnect(): void {
    this.ws?.close();
    this.ws = undefined;
    this.connected.set(false);
  }

  /**
   * Convert an HTTP base URL to its WebSocket equivalent.
   * When `httpBase` is empty, derives the base from `window.location` so the terminal
   * works in both local dev (ws://localhost) and production (wss://...).
   *
   * @param httpBase - The BFF HTTP origin (e.g. `https://admin.hugmesh.net`), or `''` for same-origin.
   * @returns The WebSocket origin (e.g. `wss://admin.hugmesh.net`).
   */
  private toWsBase(httpBase: string): string {
    if (!httpBase) {
      const loc = typeof window !== 'undefined' ? window.location : undefined;
      const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
      return loc ? `${proto}//${loc.host}` : 'ws://localhost';
    }
    // Replace the scheme prefix: http: → ws:, https: → wss:.
    return httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }

  ngOnDestroy(): void {
    // Ensure the WebSocket is closed on component teardown to avoid background frames.
    this.disconnect();
    this.term?.dispose();
  }
}
