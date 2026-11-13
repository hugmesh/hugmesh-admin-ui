import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AdminComponent } from './admin.component';
import { AnnouncementEditorComponent } from './announcements/announcement-editor.component';
import { AnnouncementListComponent } from './announcements/announcement-list.component';
import { buildPreviewDoc } from './announcements/announcement-sanitize';
import { AnubisAdminComponent } from './anubis-admin.component';
import { AppealsComponent } from './appeals/appeals.component';
import { BffService } from './bff.service';
import { CloudBackupCreateComponent } from './cloud-backups/cloud-backup-create.component';
import { DelegationComponent } from './delegation/delegation.component';
import { DesktopCatalogComponent } from './desktop-governance/desktop-catalog.component';
import { DesktopDialsComponent } from './desktop-governance/desktop-dials.component';
import { DesktopGovernanceComponent } from './desktop-governance/desktop-governance.component';
import { DesktopSshTerminalComponent } from './desktop-governance/desktop-ssh-terminal.component';
import { DesktopSudoComponent } from './desktop-governance/desktop-sudo.component';
import { DeviceLicensesComponent } from './device-licenses.component';
import { DevicePendingComponent } from './device-pending.component';
import { DeviceRadiosComponent } from './device-radios.component';
import { EgressVpnComponent } from './egress-vpn.component';
import { FleetEntitlementsComponent } from './fleet-entitlements.component';
import { ImageGenWorklistWizardComponent } from './image-gen/image-gen-worklist-wizard.component';
import { MfaStepUpDialogComponent } from './mfa/mfa-step-up-dialog.component';
import { MyFleetComponent } from './my-fleet.component';
import { NamespaceAccessComponent } from './namespace-access.component';
import { PhoneFleetComponent } from './phone-fleet.component';
import { RouteAccessComponent } from './route-access.component';
import { RouteDefinitionsComponent } from './route-definitions.component';
import { SessionService } from './session.service';
import { StoragePoolsComponent } from './storage-pools.component';
import { SuperadminDomainsComponent } from './superadmin-domains.component';
import { TestReportsComponent } from './test-reports/test-reports.component';
import { DomainThemesComponent } from './themes/domain-themes.component';
import { DomainThemesStore, MESH_DEFAULT_SEGMENT, ThemeRow } from './themes/domain-themes.service';
import { WorkloadLogsComponent } from './workload-console/workload-logs.component';
import { WorkloadTerminalComponent } from './workload-console/workload-terminal.component';
import { AdminTaskWizardComponent } from './admin-task-wizard.component';
import { ArgocdDashboardComponent } from './argocd-dashboard.component';
import { BackingServicesComponent } from './backing-services/backing-services.component';
import { BackupComponent } from './backup/backup.component';
import { RecoveryComponent } from './backup/recovery.component';
import { CloudBackupDestinationComponent } from './cloud-backups/cloud-backup-destination.component';
import { CloudBackupSetsComponent } from './cloud-backups/cloud-backup-sets.component';
import { CloudBackupTotalComponent } from './cloud-backups/cloud-backup-total.component';
import { CloudBackupsComponent } from './cloud-backups/cloud-backups.component';
import { DesktopInstallRequestsComponent } from './desktop-governance/desktop-install-requests.component';
import { ForumAdminComponent } from './forum-admin/forum-admin.component';
import { ImageGenComponent } from './image-gen/image-gen.component';
import { PackageCatalogModalComponent } from './image-gen/package-catalog-modal.component';
import { MeshTokensComponent } from './mesh-tokens.component';
import { MfaSecurityComponent } from './mfa/mfa-security.component';
import { WorkloadConsoleComponent } from './workload-console/workload-console.component';

/**
 * GUI-31: the platform palette, measured the way the admin routes actually paint.
 *
 * The 2026-11-11 GUI retest pixel-sampled these on the live mesh:
 *   - primary buttons: #e8e8f0 (--hug-text) on #7c4dff = 3.95:1, and #0a0a0a on it = 4.09:1
 *     (/admin/desktop, /admin/announcements, /admin/egress-vpn, ten-plus routes);
 *   - /admin/themes p.hint: #777 on the shell panel = 2.78:1;
 *   - inline <code> on /admin/egress-vpn and /admin/superadmin/anubis: #d63384 = 2.6-3.1:1.
 *
 * Two things make a plain token check worthless here, so this spec checks rendered colours
 * under BOTH ways the remote is served:
 *
 * 1. Mounted by the hugmesh.net host, this remote's src/styles.scss is never linked (only
 *    the exposed ./routes JS is loaded). --hug-accent then comes from the HOST :root
 *    (#7c4dff), --hug-accent-on is undefined there, and the host's Bootstrap paints every
 *    <code> with --bs-code-color (#d63384). A fix that only edits this repo's :root changes
 *    nothing on the live route. The "federated" regime reproduces that document.
 * 2. Served standalone (and under karma), this repo's own :root applies.
 *
 * The panel colours are the backgrounds the text actually lands on: the opaque --hug-bg-1
 * plus the two darkest-to-lightest panel tones the retest measured through the shell's
 * translucent scrims.
 */

type Rgb = [number, number, number];

function hex(h: string): Rgb {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb;
}

function parseColor(css: string): Rgb & { alpha?: number } {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparseable colour ${css}`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const out = [parts[0], parts[1], parts[2]] as Rgb & { alpha?: number };
  out.alpha = parts.length > 3 ? parts[3] : 1;
  return out;
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

const PANELS: Record<string, Rgb> = {
  '--hug-bg-1 (#12121e)': hex('#12121e'),
  'shell panel as delivered (#2b2e36)': hex('#2b2e36'),
  '/admin/themes panel as delivered (#363526)': hex('#363526'),
};

interface Regime {
  name: string;
  apply(): void;
}

const HOST_SIM_ID = 'gui31-host-shell-sim';

const REGIMES: Regime[] = [
  { name: "standalone (this remote's own :root)", apply: () => undefined },
  {
    name: 'federated under the host shell (host :root + Bootstrap code colour)',
    apply: () => {
      const root = document.documentElement.style;
      // hugmesh-host-shell src/styles.scss: --hug-accent: var(--sd-accent, #7c4dff); and no
      // --hug-accent-on at all ('initial' = the guaranteed-invalid value, so var() falls back).
      root.setProperty('--hug-accent', '#7c4dff');
      root.setProperty('--hug-accent-on', 'initial');
      // Bootstrap 5 reboot, as the host links it globally.
      const s = document.createElement('style');
      s.id = HOST_SIM_ID;
      s.textContent = ':root { --bs-code-color: #d63384; } code { color: var(--bs-code-color); }';
      document.head.appendChild(s);
    },
  },
];

function resetRegime(): void {
  const root = document.documentElement.style;
  root.removeProperty('--hug-accent');
  root.removeProperty('--hug-accent-on');
  document.getElementById(HOST_SIM_ID)?.remove();
}

/** The accent fill as the cascade currently resolves it. */
function resolvedAccent(): Rgb {
  const probe = document.createElement('div');
  probe.style.background = 'var(--hug-accent)';
  document.body.appendChild(probe);
  const c = parseColor(getComputedStyle(probe).backgroundColor);
  probe.remove();
  return c;
}

function sameRgb(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
}

function describeEl(el: Element): string {
  const tid = el.getAttribute('data-testid');
  const cls = el.getAttribute('class');
  return `<${el.tagName.toLowerCase()}${tid ? ` data-testid="${tid}"` : ''}${cls ? ` class="${cls}"` : ''}> "${(el.textContent ?? '').trim().slice(0, 40)}"`;
}

/** Every text run that sits on an accent fill, with its contrast against that fill. */
function accentFillReport(root: HTMLElement): { fills: number; failures: string[] } {
  const accent = resolvedAccent();
  let fills = 0;
  const failures: string[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const bg = parseColor(getComputedStyle(el).backgroundColor);
    if (bg.alpha !== 1 || !sameRgb(bg, accent)) continue;
    fills++;
    for (const t of [el, ...Array.from(el.querySelectorAll('*'))]) {
      if (!hasOwnText(t)) continue;
      const own = parseColor(getComputedStyle(t).backgroundColor);
      if (t !== el && own.alpha !== 0) continue; // text on its own surface, not the fill
      const ratio = contrast(parseColor(getComputedStyle(t).color), accent);
      if (ratio < AA_TEXT) failures.push(`${describeEl(t)} on the accent fill: ${ratio.toFixed(2)}:1`);
    }
  }
  return { fills, failures };
}

/** Each element's text colour against every dark panel it can land on. */
function panelReport(els: Element[]): string[] {
  const failures: string[] = [];
  for (const el of els) {
    const fg = parseColor(getComputedStyle(el).color);
    for (const [name, bg] of Object.entries(PANELS)) {
      const ratio = contrast(fg, bg);
      if (ratio < AA_TEXT) failures.push(`${describeEl(el)} rgb(${fg.join(', ')}) on ${name}: ${ratio.toFixed(2)}:1`);
    }
  }
  return failures;
}

const GENERIC_PROVIDERS = [provideHttpClient(), provideHttpClientTesting(), provideRouter([])];

async function render<T>(component: Type<T>, providers: unknown[] = GENERIC_PROVIDERS): Promise<ComponentFixture<T>> {
  TestBed.configureTestingModule({ imports: [component], providers: providers as never[] });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/**
 * Every component whose stylesheet paints a control with the accent fill AND whose initial
 * render (no BFF data) already shows one. Each must render at least one fill, or the
 * assertion below would pass vacuously.
 */
const ACCENT_FILL_COMPONENTS: Type<unknown>[] = [
  AdminComponent,
  AnnouncementEditorComponent,
  AnnouncementListComponent,
  AppealsComponent,
  CloudBackupCreateComponent,
  DelegationComponent,
  DesktopCatalogComponent,
  DesktopGovernanceComponent,
  DesktopSshTerminalComponent,
  DesktopSudoComponent,
  DeviceLicensesComponent,
  DevicePendingComponent,
  DeviceRadiosComponent,
  EgressVpnComponent,
  FleetEntitlementsComponent,
  ImageGenWorklistWizardComponent,
  MfaStepUpDialogComponent,
  MyFleetComponent,
  NamespaceAccessComponent,
  PhoneFleetComponent,
  RouteAccessComponent,
  RouteDefinitionsComponent,
  StoragePoolsComponent,
  SuperadminDomainsComponent,
  TestReportsComponent,
];

/** Components whose initial render already contains inline <code>. */
const CODE_COMPONENTS: Type<unknown>[] = [
  EgressVpnComponent,
  DevicePendingComponent,
  DesktopDialsComponent,
  WorkloadLogsComponent,
  WorkloadTerminalComponent,
];

/**
 * Every component that uses one of the stylesheets GUI-31 touched. The rendered checks above
 * only see what an empty (no-BFF-data) render shows, so many accent buttons, <code> runs and
 * accent-coloured text sit behind data. The compiled-stylesheet audit below covers those: it
 * reads each component's compiled CSS (ɵcmp.styles — what Angular injects for the component,
 * so it is exactly what reaches the federated page).
 */
const STYLED_COMPONENTS: Type<unknown>[] = [
  AdminComponent, AdminTaskWizardComponent, AnnouncementEditorComponent, AnnouncementListComponent,
  AnubisAdminComponent, AppealsComponent, ArgocdDashboardComponent, BackingServicesComponent,
  BackupComponent, CloudBackupCreateComponent, CloudBackupDestinationComponent, CloudBackupSetsComponent,
  CloudBackupTotalComponent, CloudBackupsComponent, DelegationComponent, DesktopCatalogComponent,
  DesktopDialsComponent, DesktopGovernanceComponent, DesktopInstallRequestsComponent,
  DesktopSshTerminalComponent, DesktopSudoComponent, DeviceLicensesComponent, DevicePendingComponent,
  DeviceRadiosComponent, DomainThemesComponent, EgressVpnComponent, FleetEntitlementsComponent,
  ForumAdminComponent, ImageGenComponent, ImageGenWorklistWizardComponent, MeshTokensComponent,
  MfaSecurityComponent, MfaStepUpDialogComponent, MyFleetComponent, NamespaceAccessComponent,
  PackageCatalogModalComponent, PhoneFleetComponent, RecoveryComponent, RouteAccessComponent,
  RouteDefinitionsComponent, StoragePoolsComponent, SuperadminDomainsComponent, TestReportsComponent,
  WorkloadConsoleComponent, WorkloadLogsComponent, WorkloadTerminalComponent,
];

/** Every component whose TEMPLATE renders <code> (grep '<code' src/app, 2026-11-11). */
const CODE_TEMPLATE_COMPONENTS: Type<unknown>[] = [
  AnubisAdminComponent, BackingServicesComponent, DesktopCatalogComponent, DesktopDialsComponent,
  DesktopInstallRequestsComponent, DevicePendingComponent, EgressVpnComponent, MeshTokensComponent,
  MfaSecurityComponent, RecoveryComponent, WorkloadConsoleComponent, WorkloadLogsComponent,
  WorkloadTerminalComponent,
];

interface CssRule {
  selector: string;
  body: string;
}

/** The flat rules of a component's compiled stylesheets (Sass output: no nesting left). */
function compiledRules(component: Type<unknown>): CssRule[] {
  const styles = (component as unknown as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles ?? [];
  const rules: CssRule[] = [];
  for (const css of styles) {
    // Angular 22.2 compiles custom properties as var(--%NS%name) and its DOM renderer
    // replaces %NS% with the CSS_VAR_NAMESPACE (empty unless provideCssVarNamespacing() is
    // used, which this app does not). Do the same here, so the audit reads what is injected.
    const flat = css.replace(/%NS%/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({ selector: m[1].trim(), body: m[2] });
    }
  }
  return rules;
}

/** A plain `color:` declaration's value (not border-color / outline-color / ...). */
function colorDecl(body: string): string | null {
  const m = body.match(/(?:^|[;\s])color\s*:\s*([^;]+)/);
  return m ? m[1].trim() : null;
}

const ACCENT_FILL = /(?:^|[;\s])background(?:-color)?\s*:\s*var\(--hug-accent\s*[,)]/;
const ACCENT_AS_TEXT = /^var\(--hug-accent\s*[,)]/;

describe('GUI-31 palette contrast (rendered colours, standalone AND federated)', () => {
  describe('compiled-stylesheet audit (covers controls an empty render does not show)', () => {
    it('reads compiled CSS for every listed component (guard premise)', () => {
      for (const component of STYLED_COMPONENTS) {
        expect(compiledRules(component).length).withContext(`${component.name} compiled rules`).toBeGreaterThan(0);
      }
    });

    it('every rule that fills with --hug-accent and sets a text colour uses --hug-accent-on', () => {
      const bad: string[] = [];
      let fills = 0;
      for (const component of STYLED_COMPONENTS) {
        for (const rule of compiledRules(component)) {
          if (!ACCENT_FILL.test(rule.body)) continue;
          const color = colorDecl(rule.body);
          if (color === null) continue; // a bar/track fill with no text of its own
          fills++;
          if (!color.startsWith('var(--hug-accent-on')) bad.push(`${component.name}: ${rule.selector} { color: ${color} }`);
        }
      }
      expect(fills).withContext('labelled accent fills found').toBeGreaterThan(25);
      expect(bad).toEqual([]);
    });

    it('no rule paints TEXT in --hug-accent (only fills/borders; --hug-accent-soft is the text token)', () => {
      const bad: string[] = [];
      for (const component of STYLED_COMPONENTS) {
        for (const rule of compiledRules(component)) {
          const color = colorDecl(rule.body);
          if (color && (ACCENT_AS_TEXT.test(color) || /var\(--hug-ok,\s*var\(--hug-accent\s*[,)]/.test(color))) {
            bad.push(`${component.name}: ${rule.selector} { color: ${color} }`);
          }
        }
      }
      expect(bad).toEqual([]);
    });

    it('every component whose template renders <code> ships a <code> colour rule on --hug-accent-soft', () => {
      const missing: string[] = [];
      for (const component of CODE_TEMPLATE_COMPONENTS) {
        const ok = compiledRules(component).some((rule) =>
          rule.selector.split(',').some((sel) => /(^|\s)code(\[_ngcontent-%COMP%\])?$/.test(sel.trim())) &&
          (colorDecl(rule.body) ?? '').startsWith('var(--hug-accent-soft'),
        );
        if (!ok) missing.push(component.name);
      }
      expect(missing).toEqual([]);
    });
  });

  afterEach(() => resetRegime());

  describe("this remote's :root accent token", () => {
    it('carries AA label text even under --hug-text, and stays a visible 3:1 border on --hug-bg-0', () => {
      const accent = resolvedAccent();
      const css = getComputedStyle(document.documentElement);
      const text = hex(css.getPropertyValue('--hug-text').trim());
      const on = hex(css.getPropertyValue('--hug-accent-on').trim());
      const bg0 = hex(css.getPropertyValue('--hug-bg-0').trim());
      expect(contrast(text, accent)).withContext('--hug-text on --hug-accent').toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(on, accent)).withContext('--hug-accent-on on --hug-accent').toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(accent, bg0)).withContext('--hug-accent border on --hug-bg-0').toBeGreaterThanOrEqual(AA_NON_TEXT);
    });
  });

  describe('announcement preview document (iframe that follows the OS colour scheme)', () => {
    // Chromium's default canvas per scheme; the preview sets no background of its own.
    const CANVAS = { light: '#ffffff', dark: '#121212' } as const;
    for (const scheme of ['light', 'dark'] as const) {
      it(`links reach AA on the ${scheme} canvas`, async () => {
        const frame = document.createElement('iframe');
        frame.srcdoc = buildPreviewDoc('Notice', '<p><a href="https://example.org/">details</a></p>');
        const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
        document.body.appendChild(frame);
        await loaded;
        const doc = frame.contentDocument!;
        doc.documentElement.style.colorScheme = scheme;
        const link = doc.querySelector('a');
        expect(link).withContext('the sanitised body keeps the link').not.toBeNull();
        const fg = parseColor(frame.contentWindow!.getComputedStyle(link!).color);
        frame.remove();
        const ratio = contrast(fg, hex(CANVAS[scheme]));
        expect(ratio).withContext(`link rgb(${fg.join(', ')}) on ${CANVAS[scheme]}`).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  });

  for (const regime of REGIMES) {
    describe(regime.name, () => {
      beforeEach(() => regime.apply());

      describe('labels on accent-filled controls', () => {
        for (const component of ACCENT_FILL_COMPONENTS) {
          it(`${component.name}: every label on an accent fill reaches ${AA_TEXT}:1`, async () => {
            const fixture = await render(component);
            const { fills, failures } = accentFillReport(fixture.nativeElement as HTMLElement);
            expect(fills).withContext('renders at least one accent fill (guard premise)').toBeGreaterThan(0);
            expect(failures).toEqual([]);
          });
        }
      });

      describe('inline <code> on dark panels', () => {
        for (const component of CODE_COMPONENTS) {
          it(`${component.name}: <code> reaches ${AA_TEXT}:1 on every panel tone`, async () => {
            const fixture = await render(component);
            const codes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('code'));
            expect(codes.length).withContext('renders at least one <code> (guard premise)').toBeGreaterThan(0);
            expect(panelReport(codes)).toEqual([]);
          });
        }

        it('AnubisAdminComponent (/admin/superadmin/anubis, not-enabled banner): <code> reaches AA', async () => {
          const bff = jasmine.createSpyObj<BffService>('BffService', ['anubisStatus', 'anubisMetrics']);
          bff.anubisStatus.and.resolveTo({
            enabled: false, reachable: false, health: 'not-enabled',
            managementUrl: 'http://hugmesh-anubis:9090', difficulty: 5,
          });
          bff.anubisMetrics.and.resolveTo({ enabled: false, raw: '', metrics: [] });
          // Not render(): ngOnInit starts a setInterval refresh, so whenStable() never settles.
          TestBed.configureTestingModule({ imports: [AnubisAdminComponent], providers: [{ provide: BffService, useValue: bff }] });
          const fixture = TestBed.createComponent(AnubisAdminComponent);
          fixture.detectChanges(); // ngOnInit: resolves the spied status
          await new Promise((r) => setTimeout(r, 0));
          fixture.detectChanges();
          const codes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('code'));
          expect(codes.length).withContext('renders the not-enabled <code> runs').toBeGreaterThan(1);
          expect(panelReport(codes)).toEqual([]);
          fixture.destroy(); // ngOnDestroy clears the refresh timer
        });
      });

      it('DevicePendingComponent: the "pending" tag on its --hug-accent-soft fill reaches AA', async () => {
        const bff = jasmine.createSpyObj<BffService>('BffService', ['pendingNodes', 'registerFromPending']);
        bff.pendingNodes.and.resolveTo([
          {
            machineKeyFp: 'nodekey:PEND1+OPAQUE/==', hostname: 'pi-edge-02', user: 'brand-a',
            meshId: 'tag:mesh_1', registered: false, domain: null, ownerType: null,
          },
        ]);
        const fixture = await render(DevicePendingComponent, [{ provide: BffService, useValue: bff }]);
        const tag = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="dp-pending"]');
        expect(tag).withContext('renders the pending tag').not.toBeNull();
        const cs = getComputedStyle(tag!);
        const ratio = contrast(parseColor(cs.color), parseColor(cs.backgroundColor));
        expect(ratio).withContext(`pending tag ${cs.color} on ${cs.backgroundColor}`).toBeGreaterThanOrEqual(AA_TEXT);
      });

      describe('/admin/themes help text', () => {
        function themesFixture(): Promise<ComponentFixture<DomainThemesComponent>> {
          const row = {
            domain: 'brandx', preset: 'nord', ramp: 'dusk', style: 'sharp', decor: 'none',
            primaryHex: undefined, secondaryHex: undefined, updatedBy: 'admin@x',
            renderedBy: 'studio', isDefault: false,
          } as ThemeRow;
          const store = {
            themes: signal<ThemeRow[]>([row]),
            loading: signal(false),
            error: signal(''),
            knownPresets: () => ['nord'],
            presetLabel: (id: string | null | undefined) => id ?? '',
            refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
            save: jasmine.createSpy('save').and.resolveTo(true),
            clear: jasmine.createSpy('clear').and.resolveTo(true),
            segmentOf: (d: string | null | undefined) => (d && d.trim() ? d.trim() : MESH_DEFAULT_SEGMENT),
          };
          return render(DomainThemesComponent, [
            { provide: DomainThemesStore, useValue: store },
            { provide: SessionService, useValue: { isSuperadmin: () => true, isAdmin: () => true } },
          ]).then((fixture) => {
            fixture.componentInstance.open(row);
            fixture.detectChanges();
            return fixture;
          });
        }

        it('the page hint and the editor field help reach AA on every panel tone', async () => {
          const fixture = await themesFixture();
          const root = fixture.nativeElement as HTMLElement;
          const hints = Array.from(root.querySelectorAll('.hint'));
          const help = Array.from(root.querySelectorAll('fieldset.editor .field small'));
          expect(hints.length).withContext('renders the page hint').toBeGreaterThan(0);
          expect(help.length).withContext('renders the editor field help').toBeGreaterThan(0);
          expect(panelReport([...hints, ...help])).toEqual([]);
        });
      });
    });
  }
});
