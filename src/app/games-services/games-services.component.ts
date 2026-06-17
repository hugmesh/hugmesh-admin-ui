import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  CreateGameInstanceRequest,
  GameInstance,
  GameOffer,
} from '../bff.service';
import { SessionService } from '../session.service';

/**
 * Games app-store operator console (own repo: snapdragon-admin-ui) — the games-services
 * control-plane operator UI mounted at /admin/games-services (route-guarded by
 * {@link gamesServicesGuard}). Reachable by a games-services ADMIN or RUNNER.
 *
 * <p>The view LISTS the catalog servers offered + enabled for the operator's domain and the
 * domain's running INSTANCES, and lets the operator CREATE an instance (from an offered
 * server) and RUN/STOP it (suspend / resume / terminate). The role split is reflected in the
 * UI as defence-in-depth on top of the BFF @PreAuthorize:
 * <ul>
 *   <li>ADMIN ({@code isGamesServicesAdmin}) — full: create + run/stop.</li>
 *   <li>RUNNER ({@code isGamesServicesRunner}, NOT admin) — run/stop only; the create form is
 *       disabled with explanatory help text (the BFF is the real gate — a runner POST is a
 *       403).</li>
 * </ul>
 * The creation gate (offered + enabled + quota) lives at the BFF; a 403 is surfaced verbatim
 * in a role=alert live region.
 */
@Component({
  selector: 'snap-games-services',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './games-services.component.html',
  styleUrl: './games-services.component.scss',
})
export class GamesServicesComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  readonly offers = signal<GameOffer[]>([]);
  readonly instances = signal<GameInstance[]>([]);

  /** A games-services ADMIN may create; a RUNNER (not admin) may only run/stop. */
  readonly canCreate = computed(() => this.session.isGamesServicesAdmin());

  /** Create-instance form state (mirrors CreateGameInstanceRequest). */
  slug = '';
  name = '';
  ttlHours = '';

  readonly formError = signal('');
  readonly actionError = signal('');

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.offers.set(await this.bff.gamesOfferedCatalog());
    this.instances.set(await this.bff.gamesInstances());
  }

  async create(): Promise<void> {
    if (!this.canCreate()) return; // belt-and-braces; the form is disabled for a runner
    const slug = this.slug.trim();
    const name = this.name.trim().toLowerCase();
    if (!slug) {
      this.formError.set('Choose a game server to run.');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
      this.formError.set('Enter an instance name (a DNS label: lowercase letters, digits, “-”).');
      return;
    }
    this.formError.set('');
    const req: CreateGameInstanceRequest = {
      slug,
      name,
      ttlSeconds: this.ttlHours.trim() ? Math.round(Number(this.ttlHours) * 3600) : null,
    };
    try {
      const created = await this.bff.createGameInstance(req);
      this.instances.set([created, ...this.instances()]);
      this.slug = '';
      this.name = '';
      this.ttlHours = '';
    } catch (e) {
      // The creation gate (403) / duplicate (409) is the BFF's {error}; surface verbatim.
      this.formError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async act(i: GameInstance, action: 'suspend' | 'resume' | 'terminate'): Promise<void> {
    this.actionError.set('');
    try {
      const updated = await this.bff.gameInstanceAction(i.id, action);
      this.instances.set(this.instances().map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
