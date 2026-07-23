import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DesktopCatalogComponent } from './desktop-catalog.component';
import { DesktopSudoComponent } from './desktop-sudo.component';
import { DesktopInstallRequestsComponent } from './desktop-install-requests.component';
import { DesktopSshTerminalComponent } from './desktop-ssh-terminal.component';
import { DesktopDialsComponent } from './desktop-dials.component';
import { BffService } from '../bff.service';
import { SessionService } from '../session.service';

/** The desktop-governance sub-tabs. */
type DesktopTab = 'catalog' | 'sudo' | 'requests' | 'terminal' | 'dials';

/**
 * The DESKTOP GOVERNANCE console (own repo: hugmesh-admin-ui). The single native-federation
 * admin module for the desktop-app-governance feature, mounted at {@code /admin/desktop}. It
 * gathers the four governance surfaces over the admin-bff {@code /bff/admin/desktop/**} foundation
 * (admin-bff PR #70, ships dark) behind an in-page tab nav, consistent with how the workload
 * console groups its sub-views:
 * <ul>
 *   <li><b>Discover curation</b> — the per-domain Plasma Discover allowlist (default-NONE; add !=
 *       enable).</li>
 *   <li><b>Desktop sudo</b> — grant/revoke SSO-enforced sudo for a (subject, device); rides the
 *       admin's device-SSH license + own-domain wall.</li>
 *   <li><b>Install-request inbox</b> — decide a user's request (approve — optionally add-to-catalog
 *       + remote-install — / deny).</li>
 *   <li><b>SSH terminal</b> — the in-UI xterm.js terminal (ships dark; authorization is real).</li>
 * </ul>
 *
 * <p>Surfaced in the admin menu for ADMIN/SUPERADMIN; the BFF re-enforces ADMIN/SUPERADMIN +
 * own-domain on every endpoint.
 */
@Component({
  selector: 'hug-desktop-governance',
  standalone: true,
  imports: [
    CommonModule,
    DesktopCatalogComponent,
    DesktopSudoComponent,
    DesktopInstallRequestsComponent,
    DesktopSshTerminalComponent,
    DesktopDialsComponent,
  ],
  templateUrl: './desktop-governance.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopGovernanceComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /** The active sub-tab as a signal so the tab nav + the lazily-rendered child stay reactive
   *  under any change-detection strategy. */
  readonly tab = signal<DesktopTab>('catalog');

  /** SUPERADMIN-only DIAL tab visibility (HIDDEN-tier). Shown only when the session is a
   *  superadmin AND the dial-leg capability probe reports it enabled (mirrors the workload-console
   *  capability gate). The parent {@code /admin/desktop} route stays ADMIN-visible; the BFF
   *  re-enforces {@code hasRole('SUPERADMIN')} on the dial endpoints regardless. */
  readonly isSuperadmin = computed(() => this.session.isSuperadmin());
  readonly dialCapable = signal(false);
  readonly dialTabVisible = computed(() => this.isSuperadmin() && this.dialCapable());

  async ngOnInit(): Promise<void> {
    // Only probe the SUPERADMIN-only dial leg for a superadmin (a plain ADMIN never sees the tab).
    if (this.isSuperadmin()) {
      this.dialCapable.set(await this.bff.desktopDialCapability());
    }
  }

  select(tab: DesktopTab): void {
    // Never select the dial tab when it is not visible (defence-in-depth against a stale nav).
    if (tab === 'dials' && !this.dialTabVisible()) return;
    this.tab.set(tab);
  }
}
