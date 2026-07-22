import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  VpnConfigRow,
  VpnNodeAssignmentRow,
} from './bff.service';

/**
 * Superadmin "Egress VPN" console (own repo: hugmesh-admin-ui). The surface over
 * the egress-VPN control plane (admin-bff EgressVpnController) — admins/superadmins
 * import provider-downloaded VPN configs (ProtonVPN WireGuard .conf first-class;
 * OpenVPN .ovpn fallback) that mesh NODES use for OUTGOING / egress traffic on
 * PUBLIC-facing flows, then assign a config to a NODE or a whole DOMAIN (optionally
 * narrowed to one public service). SUPERADMIN-only (route-guarded by
 * {@link superadminGuard}); a non-superadmin is bounced to /login.
 *
 * <p>The .conf/.ovpn text is sent to the BFF for parse-validation ONLY — the BFF
 * stores a secret_ref + parsed metadata, never the private key (secrets off-DB).
 * The import form accepts a file upload (the browser reads it locally and fills the
 * config text + defaults the name from the filename) OR a paste. Every mutation is
 * also SUPERADMIN-gated at the BFF; the registry drives the node split-tunnel egress
 * service via a signed reconcile (later PRs).
 */
@Component({
  selector: 'hug-egress-vpn',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './egress-vpn.component.html',
  styleUrl: './egress-vpn.component.scss',
})
export class EgressVpnComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly configs = signal<VpnConfigRow[]>([]);
  readonly assignments = signal<VpnNodeAssignmentRow[]>([]);
  /** The active configs (the assign-form's config picker only offers these). */
  readonly activeConfigs = computed(() => this.configs().filter((c) => c.state === 'active'));

  /** Import form state. */
  importDomain = '';
  importName = '';
  importProvider = 'protonvpn';
  importConfigText = '';
  readonly importError = signal('');

  /** Assign form state. */
  assignConfigId = '';
  assignScope: 'NODE' | 'DOMAIN' = 'NODE';
  assignNodeFp = '';
  assignDomain = '';
  assignService = '';
  readonly assignError = signal('');

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const { configs, assignments } = await this.bff.egressVpn();
    this.configs.set(configs);
    this.assignments.set(assignments);
    if (!this.assignConfigId && this.activeConfigs().length) {
      this.assignConfigId = this.activeConfigs()[0].id;
    }
  }

  /** Read the chosen .conf/.ovpn file locally and fill the import form (the bytes are
   *  sent to the BFF only on submit; they never leave the form until then). */
  async onConfigFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    this.importConfigText = await file.text();
    if (!this.importName) {
      this.importName = file.name.replace(/\.(conf|ovpn)$/i, '');
    }
  }

  async import(): Promise<void> {
    const domain = this.importDomain.trim();
    const name = this.importName.trim();
    if (!domain) {
      this.importError.set('Enter the brand domain that owns this config.');
      return;
    }
    if (!name) {
      this.importError.set('Enter a name for this config.');
      return;
    }
    if (!this.importConfigText.trim()) {
      this.importError.set('Upload or paste the WireGuard .conf / OpenVPN .ovpn config.');
      return;
    }
    this.importError.set('');
    try {
      await this.bff.importVpnConfig({
        domain,
        name,
        provider: this.importProvider.trim() || undefined,
        config: this.importConfigText,
      });
      this.importName = '';
      this.importConfigText = '';
      await this.reload();
    } catch (e) {
      // The BFF 422s a malformed config with an {error} message — surface it.
      this.importError.set((e as Error).message);
    }
  }

  async revokeConfig(configId: string): Promise<void> {
    await this.bff.revokeVpnConfig(configId);
    await this.reload();
  }

  async assign(): Promise<void> {
    if (!this.assignConfigId) {
      this.assignError.set('Pick a config to assign.');
      return;
    }
    const service = this.assignService.trim() || undefined;
    if (this.assignScope === 'NODE' && !this.assignNodeFp.trim()) {
      this.assignError.set('Enter the node machine-key fingerprint.');
      return;
    }
    if (this.assignScope === 'DOMAIN' && !this.assignDomain.trim()) {
      this.assignError.set('Enter the target domain.');
      return;
    }
    this.assignError.set('');
    try {
      if (this.assignScope === 'NODE') {
        await this.bff.assignVpnNode(this.assignConfigId, this.assignNodeFp.trim(), service);
      } else {
        await this.bff.assignVpnDomain(this.assignConfigId, this.assignDomain.trim(), service);
      }
      this.assignNodeFp = '';
      this.assignDomain = '';
      this.assignService = '';
      await this.reload();
    } catch (e) {
      this.assignError.set((e as Error).message);
    }
  }

  async unassign(assignmentId: string): Promise<void> {
    await this.bff.revokeVpnAssignment(assignmentId);
    await this.reload();
  }

  /** The display target of an assignment (node fp or domain), for the list + a11y label. */
  assignmentTarget(a: VpnNodeAssignmentRow): string {
    const base = a.scopeType === 'DEVICE' ? `node ${a.targetNodeId}` : `domain ${a.targetDomain}`;
    return a.serviceSlug ? `${base} · ${a.serviceSlug}` : `${base} · all services`;
  }
}
