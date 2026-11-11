import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BackingServicesComponent } from './backing-services/backing-services.component';
import { BackingServicesCatalog, BackingServicesService } from './backing-services/backing-services.service';
import { BffService, DomainCapability } from './bff.service';
import { DomainCapabilitiesComponent, GLOBAL_DOMAIN } from './domain-capabilities.component';
import { SessionService } from './session.service';

/**
 * Phone-width layout (GUI-30): at 390x844 /admin/backing-services was 423px wide and
 * /admin/domain-capabilities 392px, so the whole page scrolled sideways.
 *
 * Two things have to be true for the bug to show, and both are reproduced here:
 *  - a phone-width VIEWPORT, because the fix is a media query. The karma window is far
 *    wider, so the spec narrows the karma context iframe itself (window.frameElement)
 *    and asserts the viewport really is that wide before measuring anything;
 *  - the host shell's SIZING of a routed view. The shell's `router-outlet + *` backpane
 *    has auto inline margins inside a column flexbox, so the view shrinks to fit its
 *    content and never goes below that content's min-content width. Mounted in a plain
 *    block the same component would simply overflow inside it, and a check on the host
 *    box alone would pass.
 */

/** Widths checked: the reported phone (390) and the narrowest common one (320). */
const PHONE_WIDTHS = [390, 320];

/** Viewport height used throughout: the reported phone's (390x844). */
const VIEWPORT_HEIGHT = 844;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Resize the karma context iframe so media queries see a `width` x 844 viewport (null restores it). */
async function setViewportWidth(width: number | null): Promise<void> {
  const frame = window.frameElement as HTMLElement | null;
  if (!frame) {
    throw new Error(
      'phone-width specs resize the karma context iframe and cannot run without one ' +
        '(the karma debug page runs specs in the top window)',
    );
  }
  frame.style.width = width === null ? '' : `${width}px`;
  frame.style.height = width === null ? '' : `${VIEWPORT_HEIGHT}px`;
  await nextFrame();
  await nextFrame();
  if (width !== null) {
    expect(window.innerWidth).withContext('viewport width after resizing the karma iframe').toBe(width);
    expect(window.innerHeight).withContext('viewport height after resizing the karma iframe').toBe(VIEWPORT_HEIGHT);
    expect(window.matchMedia(`(max-width: ${width}px)`).matches).withContext('media queries see the narrow viewport').toBeTrue();
  }
}

/** Mount the component's host element the way the host shell mounts a routed view. */
function mountInShell(host: HTMLElement): HTMLElement {
  const main = document.createElement('main');
  main.style.cssText = 'position:absolute;top:0;left:0;width:100%;margin:0;padding:0;display:flex;flex-direction:column';
  host.style.cssText = 'display:block;margin:8px auto;padding:12px;border:1px solid';
  main.appendChild(host);
  document.body.appendChild(main);
  return main;
}

/**
 * What sticks out past the right edge of the visible page: the host itself, and anything in
 * it that a scroller inside the host does not clip. The edge is the document's client width
 * (the viewport less any classic scrollbar), the same edge the live probe measured against.
 */
function overflowReport(host: HTMLElement): string[] {
  const out: string[] = [];
  const edge = document.documentElement.clientWidth + 0.5;
  const hostRight = host.getBoundingClientRect().right;
  if (hostRight > edge) out.push(`host ends at ${Math.round(hostRight)}px, page edge is ${Math.floor(edge)}px`);
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('*'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= edge) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== host; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= edge) {
        clipped = true;
        break;
      }
    }
    if (!clipped) out.push(`${el.tagName.toLowerCase()}.${el.className} ends at ${Math.round(r.right)}px`);
  }
  return out.slice(0, 8);
}

describe('admin consoles at phone width (GUI-30)', () => {
  let shell: HTMLElement | null = null;

  afterEach(async () => {
    shell?.remove();
    shell = null;
    await setViewportWidth(null);
  });

  describe('/admin/backing-services', () => {
    let fixture: ComponentFixture<BackingServicesComponent>;

    // Shaped like the live catalog: long ids, a docs-only row (its nowrap badge is the
    // widest actions cell) and an editable one.
    const catalog: BackingServicesCatalog = {
      enabled: false,
      note: 'intent recorded only — self-hosted is the byte-identical default',
      services: [
        {
          id: 'postgres-admin-bff', kind: 'postgres', tier: 2, docsOnly: false,
          displayName: 'admin-bff database', awsTarget: 'RDS for PostgreSQL', azureTarget: 'Azure Database for PostgreSQL',
          notes: 'dual URLs', currentMode: 'self-hosted', endpoint: null, credsRef: null, generation: 0,
        },
        {
          id: 'vault-pki', kind: 'pki', tier: 3, docsOnly: true,
          displayName: 'Vault PKI', awsTarget: 'ACM Private CA', azureTarget: 'Key Vault certificates',
          notes: 'docs only', currentMode: 'self-hosted', endpoint: null, credsRef: null, generation: 0,
        },
      ],
    };

    async function render(): Promise<HTMLElement> {
      const api = jasmine.createSpyObj<BackingServicesService>('BackingServicesService', ['getCatalog', 'setMode']);
      api.getCatalog.and.resolveTo(catalog);
      TestBed.configureTestingModule({
        imports: [BackingServicesComponent],
        providers: [{ provide: BackingServicesService, useValue: api }],
      });
      fixture = TestBed.createComponent(BackingServicesComponent);
      fixture.detectChanges();
      await fixture.componentInstance.ngOnInit();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      shell = mountInShell(host);
      return host;
    }

    for (const width of PHONE_WIDTHS) {
      it(`fits a ${width}px viewport: no part of the console sticks out past the right edge`, async () => {
        const host = await render();
        await setViewportWidth(width);
        expect(overflowReport(host)).toEqual([]);
      });

      it(`shows each service as a labelled card at ${width}px, not as squeezed columns`, async () => {
        const host = await render();
        await setViewportWidth(width);
        const table = host.querySelector<HTMLElement>('[data-testid="backing-services-table"]')!;
        const tableWidth = table.getBoundingClientRect().width;
        const cells = Array.from(host.querySelectorAll<HTMLElement>('tbody td'));
        expect(cells.length).toBe(14);
        for (const td of cells) {
          // Each cell spans the card (a column layout would leave each ~1/7 of the width).
          expect(td.getBoundingClientRect().width)
            .withContext(`cell "${td.dataset['label'] ?? 'actions'}" width`)
            .toBeGreaterThan(tableWidth * 0.8);
        }
        const service = host.querySelector<HTMLElement>('[data-testid="backing-services-row-postgres-admin-bff"] td')!;
        expect(getComputedStyle(service, '::before').content).toContain('Service');
        // The column header is still in the accessibility tree, only visually hidden.
        const thead = host.querySelector<HTMLElement>('thead')!;
        expect(getComputedStyle(thead).display).not.toBe('none');
        expect(thead.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      });
    }

    it('keeps the table layout on a desktop viewport', async () => {
      const host = await render();
      await setViewportWidth(1280);
      const table = host.querySelector<HTMLElement>('[data-testid="backing-services-table"]')!;
      expect(getComputedStyle(table).display).toBe('table');
      expect(getComputedStyle(host.querySelector('thead')!).position).not.toBe('absolute');
      const service = host.querySelector<HTMLElement>('tbody td')!;
      expect(getComputedStyle(service, '::before').content).toBe('none');
    });
  });

  describe('/admin/domain-capabilities', () => {
    let fixture: ComponentFixture<DomainCapabilitiesComponent>;

    function capRow(domain: string, granted: boolean, enabled: boolean): DomainCapability {
      return { id: `id-${domain}`, domain, capability: BffService.USER_MESH_DEVICES, granted, enabled, generation: 1 };
    }

    async function render(): Promise<HTMLElement> {
      const bff = jasmine.createSpyObj<BffService>('BffService',
        ['domainCapabilities', 'setDomainCapabilityGranted', 'setDomainCapabilityEnabled']);
      bff.domainCapabilities.and.resolveTo([capRow(GLOBAL_DOMAIN, false, false), capRow('brandx', true, true)]);
      const session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
      (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => true;
      TestBed.configureTestingModule({
        imports: [DomainCapabilitiesComponent],
        providers: [
          { provide: BffService, useValue: bff },
          { provide: SessionService, useValue: session },
        ],
      });
      fixture = TestBed.createComponent(DomainCapabilitiesComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      shell = mountInShell(host);
      return host;
    }

    for (const width of PHONE_WIDTHS) {
      it(`fits a ${width}px viewport: the capability picker shrinks instead of widening the view`, async () => {
        const host = await render();
        await setViewportWidth(width);
        expect(overflowReport(host)).toEqual([]);
      });
    }

    // The picker's natural width is the longest option label in the CURRENT font, so whether
    // 390px is tight depends on the fonts installed. 320px must be tight everywhere, or the
    // overflow check above proves nothing; this pins that precondition.
    it('has a capability label wider than a 320px phone leaves for it (precondition of the check above)', async () => {
      const host = await render();
      await setViewportWidth(320);
      const select = host.querySelector<HTMLSelectElement>('#dc-capability')!;
      const budget = document.documentElement.clientWidth - 2 * 12 - 2 * 1; // less the shell's padding + border
      const prev = select.style.cssText;
      select.style.cssText = 'width:max-content;max-width:none';
      const natural = select.getBoundingClientRect().width;
      select.style.cssText = prev;
      expect(natural).toBeGreaterThan(budget);
    });

    it('keeps the capability picker at its natural width, beside its label, on a desktop viewport', async () => {
      const host = await render();
      await setViewportWidth(1280);
      const select = host.querySelector<HTMLSelectElement>('#dc-capability')!;
      const label = host.querySelector<HTMLElement>('label[for="dc-capability"]')!;
      const section = host.querySelector<HTMLElement>('.domain-capabilities')!;
      expect(select.getBoundingClientRect().width).toBeLessThan(section.getBoundingClientRect().width * 0.8);
      expect(Math.abs(select.getBoundingClientRect().top - label.getBoundingClientRect().top)).toBeLessThan(12);
    });
  });
});
