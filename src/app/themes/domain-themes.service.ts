import { Injectable, computed, inject, signal } from '@angular/core';
import { DomainThemeAdminControllerService } from '../api/services/domain-theme-admin-controller.service';
import { DomainTheme } from '../api/models/domain-theme';

/**
 * The reserved path segment for the MESH DEFAULT.
 *
 * The default's storage key is the EMPTY string, which cannot be a URL path segment, so
 * it needs a name — and one no real domain can take, or a brand could hijack the row
 * every other brand inherits. A registry-sanitized domain is `[a-z0-9-]`, so the
 * underscore is what makes this safe. It must stay identical to
 * `DomainThemeAdminController.DEFAULT_SEGMENT` and the Studio's `DEFAULT_SEGMENT`.
 */
export const MESH_DEFAULT_SEGMENT = '_default';

/**
 * The time-of-day ramps and shape styles, mirroring the closed vocabularies the BFF
 * validates (`DomainThemeRequest`) and the Studio derives from
 * (`theme_presets.RAMPS`, `theme.STYLE_VARIANTS`).
 *
 * Restated here ON PURPOSE rather than fetched: they are what the `<select>`s render, and
 * a dropdown built from a network call shows an empty list when that call fails. The cost
 * is a third copy that must move when a ramp is added — which is why the BFF rejects an
 * out-of-vocabulary value with a 400 naming the field, so a stale UI fails loudly here
 * rather than silently rendering a fallback theme.
 */
export const RAMPS = [
  'dark', 'light', 'dawn', 'morning', 'afternoon', 'dusk', 'evening', 'midnight',
] as const;
export const STYLES = ['soft', 'sharp', 'outlined', 'elevated', 'flat', 'glass'] as const;

export type Ramp = (typeof RAMPS)[number];
export type Style = (typeof STYLES)[number];

/** One domain's theme as the editor works with it. */
export interface ThemeRow extends DomainTheme {
  /** True for the mesh-default row — superadmin-only, and inherited by every domain. */
  isDefault: boolean;
}

/**
 * Store for per-domain themes.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: derive any colour. The maths has exactly one
 * implementation, in the Studio's Python, and the BFF only ever serves bytes it was
 * handed. A TypeScript re-derivation here would be a third implementation whose drift
 * would show as this editor previewing one theme while the page renders another.
 *
 * The consequence is visible in the UI and has to be: saving a CHANGED selection from
 * here clears the stored stylesheet (the BFF drops a render that no longer matches its
 * selection), so the domain falls back to the shipped chrome until the Studio re-renders.
 * That is un-themed rather than wrong, and the editor says so before the operator saves
 * rather than letting them discover it on the live page.
 */
@Injectable({ providedIn: 'root' })
export class DomainThemesStore {
  private readonly api = inject(DomainThemeAdminControllerService);

  readonly themes = signal<ThemeRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  /** Every preset id already in use somewhere on the mesh, for the suggestion list.
   *  The authoritative catalogue lives in the Studio (it owns the colour data), so this
   *  is a convenience, never a constraint — the field stays free text. */
  readonly knownPresets = computed(() =>
    [...new Set(this.themes().map((t) => t.preset).filter(Boolean))].sort() as string[],
  );

  /** The mesh-default row, if the caller may see it. */
  readonly meshDefault = computed(() => this.themes().find((t) => t.isDefault) ?? null);

  /** Real domains, i.e. everything that is not the default. */
  readonly domains = computed(() => this.themes().filter((t) => !t.isDefault));

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await this.api.domainThemeAdminList();
      const rows = ((res?.['themes'] ?? []) as DomainTheme[]).map((t) => ({
        ...t,
        // The BFF keys the default on the empty string; it arrives as '' or absent.
        isDefault: !t.domain,
      }));
      this.themes.set(rows);
    } catch (e) {
      this.error.set(this.explain(e, 'load the themes'));
    } finally {
      this.loading.set(false);
    }
  }

  /** The path segment for a row — the reserved literal for the default. */
  segmentOf(domain: string | null | undefined): string {
    return domain && domain.trim() ? domain.trim() : MESH_DEFAULT_SEGMENT;
  }

  async save(domain: string, body: {
    preset: string; ramp: string; style: string;
    primaryHex?: string; secondaryHex?: string;
  }): Promise<boolean> {
    this.error.set('');
    try {
      // renderedCss is deliberately NOT sent: this editor cannot derive it. The BFF
      // keeps the existing stylesheet when the selection is unchanged and drops it when
      // it is not, which is why the UI warns before a changing save.
      await this.api.domainThemeAdminSet({ domain: this.segmentOf(domain), body });
      await this.refresh();
      return true;
    } catch (e) {
      this.error.set(this.explain(e, `save the theme for ${this.describe(domain)}`));
      return false;
    }
  }

  async clear(domain: string): Promise<boolean> {
    this.error.set('');
    try {
      await this.api.domainThemeAdminClear({ domain: this.segmentOf(domain) });
      await this.refresh();
      return true;
    } catch (e) {
      this.error.set(this.explain(e, `clear the theme for ${this.describe(domain)}`));
      return false;
    }
  }

  private describe(domain: string | null | undefined): string {
    return domain && domain.trim() ? `domain '${domain.trim()}'` : 'the mesh default';
  }

  /**
   * Turn a failure into the thing the operator has to DO about it.
   *
   * A bare 403 is genuinely ambiguous on this endpoint: a domain admin editing the mesh
   * default and an admin editing a neighbour's domain both land on it, and the fixes
   * differ. Hiding the control would not have prevented either — the BFF is the gate —
   * so the message has to carry the reason.
   */
  private explain(e: unknown, action: string): string {
    const status = (e as { status?: number })?.status;
    if (status === 403) {
      return `You do not have permission to ${action}. A domain admin may change only their own domain, and the mesh default is superadmin-only because it repaints every domain that has not overridden it.`;
    }
    if (status === 401) {
      return 'Your session is not accepted by the mesh. Sign in again and retry.';
    }
    if (status === 400) {
      return `The mesh rejected the theme: check the preset, ramp and style. (Could not ${action}.)`;
    }
    return `Could not ${action}.`;
  }
}
