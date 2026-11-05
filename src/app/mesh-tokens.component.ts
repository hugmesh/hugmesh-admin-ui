import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  MeshTokenIssueResult,
  MeshTokenIssued,
  MeshTokenIssuer,
  MeshTokenRole,
} from './bff.service';
import { SessionService } from './session.service';
import { MfaStepUpDialogComponent } from './mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from './mfa/step-up-error';

/** Seconds in a day — the lifetime control works in whole days. */
const DAY = 86_400;
/** HUGMESH-TOKEN.md: `expires` is at most 90 days after `issued`. */
const MAX_DAYS = 90;
/** The default lifetime the issuing form starts at. */
const DEFAULT_DAYS = 7;
/** Every role a v1 token can carry, in display order. */
const ALL_ROLES: readonly MeshTokenRole[] = ['user', 'mod', 'admin', 'superadmin'];
/** HUGMESH-TOKEN.md `mesh`/node-name label rule; empty is allowed for node_name. */
const NODE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The page's view of the issuer read: still loading, live, dark (feature off), or failed. */
type IssuerView =
  | { kind: 'loading' }
  | { kind: 'ok'; issuer: MeshTokenIssuer }
  | { kind: 'dark'; reason: string }
  | { kind: 'error'; reason: string };

/**
 * "Mesh tokens" console (ADMIN/SUPERADMIN): issue a HugMesh token — one signed line a Studio tray
 * imports to join this mesh in one access domain, as one role, with or without shell
 * (hugmesh-generator docs/HUGMESH-TOKEN.md, v1) — over admin-bff's `/bff/admin/mesh-tokens`.
 *
 * <p>The ISSUER FINGERPRINT is the trust anchor: a tray shows it on first import and the operator
 * must confirm it matches one the issuer handed them out of band, so the page leads with it.
 *
 * <p>Secrets: the issuer private key never leaves the BFF. The TOKEN comes back from the issue
 * call once and lives ONLY in {@link revealed} — a component signal, so leaving the page (which
 * destroys this component) drops it, and {@link ngOnDestroy} clears it explicitly too. It is never
 * written to storage, the router (URL/state), a form control (no browser form-state restore), or
 * the console. The audit table renders an explicit column whitelist with no token column.
 *
 * <p>Gating mirrors the BFF (which is authoritative): role `superadmin` is offered only to a
 * superadmin; shell only for role admin/superadmin; lifetime 1..90 days (default 7), further
 * capped by the issuer's `maxLifetimeSeconds`. Issuing is step-up gated exactly like the
 * device-licenses ssh-issue flow: a "requires step-up" 403 opens the inline
 * {@link MfaStepUpDialogComponent} and the SAME issue call is retried blindly on success. No modal
 * or native dialog anywhere — every outcome is an inline status line.
 *
 * <p>SHIPS DARK: while `app.mesh-token.enabled=false` the issuer read is a 503 whose sentence names
 * the switch (`make stack-up HEADSCALE=1` on the local docker mesh); the page renders that
 * sentence and no form.
 */
@Component({
  selector: 'hug-mesh-tokens',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './mesh-tokens.component.html',
  styleUrl: './mesh-tokens.component.scss',
})
export class MeshTokensComponent implements OnInit, OnDestroy {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /** Fallback dark sentence when the BFF's 503 carried none. */
  static readonly DARK_FALLBACK =
    'Mesh-token issuing is not enabled on this deployment. On the local docker mesh, start the '
    + 'stack with: make stack-up HEADSCALE=1';

  readonly view = signal<IssuerView>({ kind: 'loading' });
  readonly audit = signal<MeshTokenIssued[]>([]);
  readonly busy = signal(false);
  /** The last action's inline outcome (role=status for ok, role=alert for err). */
  readonly note = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** A pending step-up challenge; `retry` re-runs the SAME issue call once satisfied. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);
  /** The just-issued token — shown once, never persisted, cleared on hide/destroy. */
  readonly revealed = signal<MeshTokenIssueResult | null>(null);
  /** Inline "copied" confirmation next to the fingerprint / token copy buttons. */
  readonly copyNote = signal<{ target: 'fingerprint' | 'token'; text: string } | null>(null);

  /**
   * The roles this caller may grant. The BFF's own `roles` list (decided from its principal, so
   * never stale) wins when present; otherwise the session mirror decides. Either way `superadmin`
   * is offered only to a superadmin, and the BFF re-checks every issue.
   */
  readonly roleOptions = computed<MeshTokenRole[]>(() => {
    const v = this.view();
    const fromServer = v.kind === 'ok' ? v.issuer.roles : undefined;
    if (Array.isArray(fromServer) && fromServer.length) {
      return ALL_ROLES.filter((r) => fromServer.includes(r));
    }
    return this.session.isSuperadmin() ? [...ALL_ROLES] : ALL_ROLES.filter((r) => r !== 'superadmin');
  });

  // ── Issue form (ngModel-bound plain fields) ──
  domain = '';
  role: MeshTokenRole = 'user';
  shell = false;
  lifetimeDays = DEFAULT_DAYS;
  nodeName = '';
  /** Inline validation message for the form (role=alert). */
  readonly formError = signal('');

  async ngOnInit(): Promise<void> {
    const state = await this.bff.meshTokenIssuer();
    if (state.kind === 'ok') {
      this.view.set({ kind: 'ok', issuer: state.issuer });
      if (!this.domain && state.issuer.domains.length) this.domain = state.issuer.domains[0].domain;
      const def = state.issuer.defaultLifetimeSeconds;
      const defDays = def && def >= DAY ? Math.floor(def / DAY) : DEFAULT_DAYS;
      this.lifetimeDays = Math.min(defDays, this.maxDays());
      await this.refreshAudit();
    } else if (state.kind === 'dark') {
      this.view.set({ kind: 'dark', reason: state.reason || MeshTokensComponent.DARK_FALLBACK });
    } else {
      this.view.set({ kind: 'error', reason: state.reason || 'The issuer could not be loaded.' });
    }
  }

  ngOnDestroy(): void {
    // Belt and braces: the component (and its signals) die with navigation anyway.
    this.revealed.set(null);
  }

  /** The live issuer, or null while loading/dark/failed. */
  issuer(): MeshTokenIssuer | null {
    const v = this.view();
    return v.kind === 'ok' ? v.issuer : null;
  }

  /** Whole days the lifetime may span: min(90, issuer cap), never below 1. */
  maxDays(): number {
    const cap = this.issuer()?.maxLifetimeSeconds;
    const capDays = cap && cap > 0 ? Math.floor(cap / DAY) : MAX_DAYS;
    return Math.max(1, Math.min(MAX_DAYS, capDays));
  }

  /** Shell may be granted only to role admin or superadmin (HUGMESH-TOKEN.md). */
  shellAllowed(): boolean {
    return this.role === 'admin' || this.role === 'superadmin';
  }

  /** Role changed: a role that cannot carry shell drops a previously ticked box. */
  onRoleChange(role: MeshTokenRole): void {
    this.role = role;
    if (!this.shellAllowed()) this.shell = false;
  }

  /** The login server a token for the selected domain will carry (display only). */
  loginServerFor(domain: string): string {
    return this.issuer()?.domains.find((d) => d.domain === domain)?.loginServer ?? '';
  }

  /** Validate, then issue behind the step-up gate. The token is revealed once on success. */
  async issue(): Promise<void> {
    const issuer = this.issuer();
    if (!issuer) return;
    const nodeName = this.nodeName.trim();
    const days = Number(this.lifetimeDays);
    if (!issuer.domains.some((d) => d.domain === this.domain)) {
      this.formError.set('Choose a domain to issue for.');
      return;
    }
    if (!this.roleOptions().includes(this.role)) {
      this.formError.set('Choose a role you are allowed to grant.');
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > this.maxDays()) {
      this.formError.set(`Lifetime must be a whole number of days from 1 to ${this.maxDays()}.`);
      return;
    }
    if (nodeName && !NODE_NAME.test(nodeName)) {
      this.formError.set('Node name: lower-case letters, digits and dashes, starting with a letter or digit (max 63).');
      return;
    }
    this.formError.set('');
    const request = {
      domain: this.domain,
      role: this.role,
      shell: this.shellAllowed() && this.shell,
      lifetimeSeconds: days * DAY,
      nodeName,
    };
    // A new issue replaces (and so hides) any token still on screen.
    this.revealed.set(null);
    this.copyNote.set(null);
    await this.runGated('Issuing this mesh token', async () => {
      const result = await this.bff.issueMeshToken(request);
      this.revealed.set(result);
      this.note.set({ kind: 'ok', text: 'Token issued. Copy it now — it is shown once and never stored.' });
      await this.refreshAudit();
    });
  }

  /** Hide the revealed token (the operator has copied it). It cannot be shown again. */
  hideToken(): void {
    this.revealed.set(null);
    this.copyNote.set(null);
    this.note.set({ kind: 'ok', text: 'Token hidden. Issue a new one if it was not copied.' });
  }

  async copyFingerprint(): Promise<void> {
    const fp = this.issuer()?.fingerprint;
    if (fp) await this.copy('fingerprint', fp);
  }

  async copyToken(): Promise<void> {
    const t = this.revealed()?.token;
    if (t) await this.copy('token', t);
  }

  /** `expires` as a readable UTC timestamp, from Unix seconds or an ISO string. */
  formatExpiry(expires: number | string): string {
    const d = typeof expires === 'number' ? new Date(expires * 1000) : new Date(expires);
    return Number.isNaN(d.getTime()) ? String(expires) : d.toISOString().replace('.000Z', 'Z');
  }

  /** The step-up dialog succeeded — retry the gated action it was blocking. */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The operator cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  private async refreshAudit(): Promise<void> {
    this.audit.set(await this.bff.meshTokensIssued());
  }

  /**
   * Run a step-up-gated mutation behind the busy guard (the device-licenses `runSshGated`
   * shape): a "requires step-up" 403 opens the inline MFA dialog and BLINDLY retries `fn` on
   * success; any other failure becomes an inline error note.
   */
  private async runGated(action: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.note.set(null);
    try {
      await fn();
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.busy.set(false);
        this.stepUpChallenge.set({ action, retry: () => this.runGated(action, fn) });
        return;
      }
      this.note.set({ kind: 'err', text: e instanceof Error ? e.message : 'The token could not be issued.' });
    } finally {
      this.busy.set(false);
    }
  }

  private async copy(target: 'fingerprint' | 'token', text: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      this.copyNote.set({ target, text: 'Copied.' });
    } catch {
      this.copyNote.set({ target, text: 'Copy failed — select the text and copy it by hand.' });
    }
  }
}
