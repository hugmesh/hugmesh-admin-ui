import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Terminal } from '@xterm/xterm';
import { BffService } from '../bff.service';

declare const __SNAP_BFF_URL__: string | undefined;

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
  selector: 'snap-workload-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workload-terminal.component.html',
  styleUrl: './workload-console.component.scss',
})
export class WorkloadTerminalComponent implements AfterViewInit, OnDestroy {
  private readonly bff = inject(BffService);

  @ViewChild('term', { static: false }) termRef?: ElementRef<HTMLDivElement>;

  namespace = 'snapdragon-backend';
  pod = '';
  container = '';
  command = '/bin/sh';

  readonly connected = signal(false);
  readonly statusMsg = signal('');
  readonly error = signal('');

  private term?: Terminal;
  private ws?: WebSocket;

  ngAfterViewInit(): void {
    // The terminal is created lazily on connect so the element is laid out + we avoid
    // touching xterm during SSR/headless test bootstrap.
  }

  /** Mint a fresh step-up token then open the TTY WebSocket. */
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

    const bffBase = (typeof __SNAP_BFF_URL__ !== 'undefined' && __SNAP_BFF_URL__) ? __SNAP_BFF_URL__ : '';
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

  ngOnDestroy(): void {
    this.disconnect();
    this.term?.dispose();
  }
}
