import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, GrantableRole } from '../bff.service';

/** One offered role: what it unlocks, in the operator's words, and how it behaves. */
interface RoleOption {
  role: GrantableRole;
  label: string;
  /** What holding this role actually lets the person DO. */
  unlocks: string;
  /** Grouping so the list reads as capabilities, not an alphabet of constants. */
  group: 'Platform access' | 'Connect your own client' | 'Staff' | 'Restrictions' | 'Other';
}

/**
 * Admin "Roles" console (ROLE_ADMIN; the route guard is the authoritative gate).
 *
 * The mesh had no role-granting UI at all — the only way to give someone a role
 * was the Studio desktop dialog, which is not available to an admin working in a
 * browser (operator report 2026-08-14). The endpoints existed the whole time:
 * POST|DELETE /bff/admin/roles/{roleName}/{user}.
 *
 * <p>The offered list mirrors AdminController's CLOSED grantable vocabulary
 * exactly, so this console can never offer a role the server would reject.
 * Service/bootstrap roles (ROLE_SUPERADMIN, ROLE_GATEWAY, ROLE_API,
 * ROLE_ADMIN_API, ROLE_SERVICE) are deliberately NOT in that vocabulary and are
 * therefore absent here — they are not grantable through this surface at all.
 *
 * <p>THE HONEST CAVEAT, surfaced in the UI rather than buried: this endpoint
 * writes the platform's own account store. Where the deployment reports
 * `casdoorAdminEnabled: false`, the grant is recorded but does NOT reach Casdoor,
 * so the identity provider still decides what the user's token carries. The
 * console says so instead of implying an instant, complete effect.
 */
@Component({
  selector: 'hug-roles',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './roles.component.html',
  styleUrl: './roles.component.scss',
})
export class RolesComponent {
  private readonly bff = inject(BffService);

  readonly user = signal('');
  readonly busy = signal(false);
  /** Result line for the last action (role=status live region). */
  readonly result = signal('');
  readonly failed = signal(false);

  /**
   * EXACTLY AdminController.GRANTABLE_ROLE_PATTERN, grouped so an admin reads
   * capabilities rather than constants. "Connect your own client" is called out
   * as its own group because it is the grant operators ask for by name: it lets
   * a member point a native Matrix or Mastodon app at this mesh instead of being
   * confined to the built-in web UI.
   */
  readonly roles: readonly RoleOption[] = [
    { role: 'ROLE_USER', label: 'Member', group: 'Platform access',
      unlocks: 'The baseline every signed-in person needs. Without it most surfaces refuse.' },
    { role: 'ROLE_MATRIX', label: 'Matrix access', group: 'Platform access',
      unlocks: 'Use Matrix chat through this mesh (/social/matrix).' },
    { role: 'ROLE_MASTODON', label: 'Mastodon access', group: 'Platform access',
      unlocks: 'Use Mastodon through this mesh (/social/mastodon).' },
    { role: 'ROLE_GAMES', label: 'Games access', group: 'Platform access',
      unlocks: 'Reach the games surfaces.' },

    { role: 'ROLE_MATRIX_EXTERNAL_CLIENT', label: 'Own Matrix client', group: 'Connect your own client',
      unlocks: 'Connect a native Matrix app (Element, FluffyChat, …) directly to this '
             + 'mesh, instead of only the built-in web chat. The connection details '
             + 'appear at the top of their Matrix tab once granted.' },
    { role: 'ROLE_MASTODON_EXTERNAL_CLIENT', label: 'Own Mastodon client', group: 'Connect your own client',
      unlocks: 'Connect a native Mastodon app (Tusky, Ivory, …) directly to this mesh. '
             + 'The connection details appear at the top of their Mastodon tab once granted.' },

    { role: 'ROLE_MOD', label: 'Moderator', group: 'Staff',
      unlocks: 'Opens the moderation console (/mod): queue, bans, domain-locks, audit.' },
    { role: 'ROLE_ADMIN', label: 'Administrator', group: 'Staff',
      unlocks: 'Opens the admin console (/admin) and can decide referred moderation cases.' },
    { role: 'ROLE_FLEET_ADMIN', label: 'Fleet administrator', group: 'Staff',
      unlocks: 'Fleet/device administration surfaces.' },
    { role: 'ROLE_GAMES_ADMIN', label: 'Games administrator', group: 'Staff',
      unlocks: 'Games administration. NOTE: normally DERIVED (games ∩ admin/mod) by a '
             + 'sync job — granting it directly can be overwritten by that job.' },
    { role: 'ROLE_IMAGE_BUILDER', label: 'Image builder', group: 'Staff',
      unlocks: 'Permitted to run image builds.' },

    { role: 'ROLE_MATRIX_DOMAINLOCKED', label: 'Matrix: local-only', group: 'Restrictions',
      unlocks: 'A RESTRICTION, not a grant: forces this person’s Matrix activity to stay '
             + 'on this mesh (no federation). They keep their base Matrix access.' },
    { role: 'ROLE_MASTODON_DOMAINLOCKED', label: 'Mastodon: local-only', group: 'Restrictions',
      unlocks: 'A RESTRICTION, not a grant: forces this person’s Mastodon activity to stay '
             + 'on this mesh (no federation). They keep their base Mastodon access.' },
  ];

  readonly groups: readonly RoleOption['group'][] =
    ['Platform access', 'Connect your own client', 'Staff', 'Restrictions'];

  rolesIn(group: RoleOption['group']): readonly RoleOption[] {
    return this.roles.filter(r => r.group === group);
  }

  /** True when the form can be submitted (a username is required by the endpoint). */
  canSubmit(): boolean {
    return !this.busy() && this.user().trim().length > 0;
  }

  async grant(role: GrantableRole, label: string): Promise<void> {
    await this.run(() => this.bff.grantRole(role, this.user().trim()),
      `Granted ${label} to ${this.user().trim()}.`);
  }

  async revoke(role: GrantableRole, label: string): Promise<void> {
    await this.run(() => this.bff.revokeRole(role, this.user().trim()),
      `Revoked ${label} from ${this.user().trim()}.`);
  }

  /** One place that owns busy/result/failed so no path can report success on a throw. */
  private async run(action: () => Promise<unknown>, okMessage: string): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.busy.set(true);
    this.result.set('');
    this.failed.set(false);
    try {
      await action();
      this.result.set(okMessage);
    } catch (e) {
      this.failed.set(true);
      this.result.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
