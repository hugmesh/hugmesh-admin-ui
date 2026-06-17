import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DesktopCatalogComponent } from './desktop-catalog.component';
import { DesktopSudoComponent } from './desktop-sudo.component';
import { DesktopInstallRequestsComponent } from './desktop-install-requests.component';
import { DesktopSshTerminalComponent } from './desktop-ssh-terminal.component';

/** The desktop-governance sub-tabs. */
type DesktopTab = 'catalog' | 'sudo' | 'requests' | 'terminal';

/**
 * The DESKTOP GOVERNANCE console (own repo: snapdragon-admin-ui). The single native-federation
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
  selector: 'snap-desktop-governance',
  standalone: true,
  imports: [
    CommonModule,
    DesktopCatalogComponent,
    DesktopSudoComponent,
    DesktopInstallRequestsComponent,
    DesktopSshTerminalComponent,
  ],
  templateUrl: './desktop-governance.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopGovernanceComponent {
  tab: DesktopTab = 'catalog';

  select(tab: DesktopTab): void {
    this.tab = tab;
  }
}
