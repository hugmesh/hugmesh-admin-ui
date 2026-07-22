import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, DesktopCatalogEntry, DesktopSource } from '../bff.service';

/**
 * The DESKTOP DISCOVER CURATION table (own repo: hugmesh-admin-ui). The admin front-end for
 * the desktop-governance catalog surface (admin-bff {@code DesktopCatalogAdminController} at
 * {@code /bff/admin/desktop/catalog}). The admin curates which Flatpak/OCI apps a brand's
 * Plasma Discover store MAY offer.
 *
 * <p><b>DEFAULT-NONE / add != enable.</b> The store ships with NOTHING; adding a ref to the
 * catalog does not make it appear in Discover — a SEPARATE enable flip is what surfaces a row.
 * The registry endpoint the on-device Discover consults serves ONLY this domain's <b>enabled</b>
 * refs, so an empty/all-disabled catalog serves nothing. The table makes that two-step explicit:
 * an added-but-disabled row shows a clear "not in store (default-none)" state with an Enable
 * action, and each enabled row shows a Disable.
 *
 * <p><b>Domain scoping.</b> The catalog is per-domain (the {@code domain} is stamped from the
 * caller's validated issuer at the BFF — NEVER a UI field). A scoped ADMIN sees + mutates only
 * their own brand; a SUPERADMIN sees every brand. The table surfaces each row's {@code domain}
 * so a superadmin can tell brands apart; the BFF is the authority on scope (cross-domain rows are
 * invisible to a scoped admin).
 */
@Component({
  selector: 'hug-desktop-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './desktop-catalog.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopCatalogComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly entries = signal<DesktopCatalogEntry[]>([]);
  readonly loaded = signal(false);
  /** True once at least one row exists AND every row is disabled — the store serves NOTHING. */
  readonly storeEmpty = computed(() => this.entries().every((e) => !e.enabled));

  /** Add form state. */
  appRef = '';
  displayName = '';
  source: DesktopSource = 'FLATPAK';
  readonly addError = signal('');

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.entries.set(await this.bff.desktopCatalog());
    this.loaded.set(true);
  }

  /** Add a ref to the brand catalog (DISABLED — add != enable). Locally validates the
   *  required fields (no BFF call when blank); surfaces the BFF {error} on a reject and
   *  KEEPS the form so the admin can fix it. */
  async add(): Promise<void> {
    const appRef = this.appRef.trim();
    const displayName = this.displayName.trim();
    if (!appRef) {
      this.addError.set('Enter the Flatpak/OCI app reference (e.g. org.mozilla.firefox).');
      return;
    }
    if (!displayName) {
      this.addError.set('Enter a display name for the app.');
      return;
    }
    this.addError.set('');
    try {
      await this.bff.desktopCatalogAdd(appRef, displayName, this.source);
      this.appRef = '';
      this.displayName = '';
      await this.reload();
    } catch (e) {
      this.addError.set((e as Error).message);
    }
  }

  async enable(id: string): Promise<void> {
    await this.bff.desktopCatalogEnable(id);
    await this.reload();
  }

  async disable(id: string): Promise<void> {
    await this.bff.desktopCatalogDisable(id);
    await this.reload();
  }

  async remove(id: string): Promise<void> {
    await this.bff.desktopCatalogRemove(id);
    await this.reload();
  }
}
