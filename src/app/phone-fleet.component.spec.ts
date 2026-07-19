import { ComponentFixture, TestBed } from '@angular/core/testing';
import { formatDate } from '@angular/common';
import { PhoneFleetComponent } from './phone-fleet.component';
import { BffService, PhoneDevice } from './bff.service';

const fixturePhones = (): PhoneDevice[] => [
  {
    id: 'row-1',
    deviceId: 'phone-a1b2c3',
    deviceClass: 'phone',
    serial: 'SER-0001',
    codename: 'komodo',
    marketingName: 'Pixel 9 Pro',
    os: 'GrapheneOS',
    osVersion: '2026070800',
    superdomain: 'snapdragon.systems',
    loginServer: 'https://headscale.snapdragon.systems',
    tailscaleIp: '100.64.0.7',
    tailscaleHostname: 'phone-a1b2c3',
    role: 'personal',
    attachedDomain: 'domain-a',
    enterpriseProfilePresent: true,
    enterpriseProfileUserId: 10,
    enterpriseProfileCredentialCustody: 'device',
    attestationUrl: 'https://attestation.snapdragon.systems',
    auditorPackage: 'systems.snapdragon.auditor',
    attestationVerdict: 'verified',
    enrolledAt: '2026-07-01T10:00:00Z',
    generatedAt: '2026-06-30T08:00:00Z',
    firstIngestedAt: '2026-07-01T10:05:00Z',
    lastIngestedAt: '2026-07-18T09:30:00Z',
    ingestCount: 42,
  },
  {
    // A minimal row (first ingest only): every optional field absent, so the
    // template's '—' fallbacks render instead of blank cells.
    id: 'row-2',
    deviceId: 'phone-d4e5f6',
    enterpriseProfilePresent: false,
    ingestCount: 1,
  },
];

describe('PhoneFleetComponent', () => {
  let fixture: ComponentFixture<PhoneFleetComponent>;
  let component: PhoneFleetComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['phones']);
    bff.phones.and.resolveTo(fixturePhones());
    await TestBed.configureTestingModule({
      imports: [PhoneFleetComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(PhoneFleetComponent);
    component = fixture.componentInstance;
  });

  /** Trigger the component lifecycle (which runs ngOnInit ONCE) then flush the awaited
   *  load boundary before rendering. */
  async function init(): Promise<void> {
    fixture.detectChanges();           // fires ngOnInit via the lifecycle (once)
    await fixture.whenStable();        // phones() resolved
    fixture.detectChanges();           // render with the loaded data
  }

  /** Toggle a row's detail THROUGH the real expand button (a DOM click is what marks the
   *  view dirty under the notification-based change-detection scheduler, and is also what
   *  drives the toggle in production). */
  function clickExpand(deviceId: string): void {
    const button = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(`[data-expand="${deviceId}"]`)!;
    button.click();
    fixture.detectChanges();
  }

  it('loads the fleet on init and renders one row per phone in the BFF order', async () => {
    await init();

    expect(bff.phones).toHaveBeenCalledTimes(1);
    expect(component.phones().length).toBe(2);
    expect(component.loading()).toBeFalse();

    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('[data-phone-id]');
    expect(rows.length).toBe(2);
    // The BFF orders newest ingest activity first; the table preserves that order.
    expect(rows[0].getAttribute('data-phone-id')).toBe('phone-a1b2c3');
    expect(rows[1].getAttribute('data-phone-id')).toBe('phone-d4e5f6');
    expect(el.querySelector('[data-testid="pf-empty"]')).toBeNull();
  });

  it('renders the summary columns (device name, OS, enterprise-profile + attestation chips)', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    const row = el.querySelector('[data-phone-id="phone-a1b2c3"]')!;
    expect(row.querySelector('.p-device')!.textContent).toContain('Pixel 9 Pro');
    expect(row.querySelector('.p-os')!.textContent).toContain('GrapheneOS');
    expect(row.querySelector('.p-domain')!.textContent).toContain('domain-a');
    expect(row.querySelector('.p-tailscale')!.textContent).toContain('100.64.0.7');
    expect(row.querySelector('[data-ep="true"]')!.textContent!.trim()).toBe('present');
    expect(row.querySelector('[data-verdict="verified"]')).not.toBeNull();
    expect(row.querySelector('.p-ingests')!.textContent!.trim()).toBe('42');

    // The minimal row falls back to '—' / 'none' / 'unknown' instead of blank cells.
    const minimal = el.querySelector('[data-phone-id="phone-d4e5f6"]')!;
    expect(minimal.querySelector('.p-role')!.textContent!.trim()).toBe('—');
    expect(minimal.querySelector('[data-ep="false"]')!.textContent!.trim()).toBe('none');
    expect(minimal.querySelector('[data-verdict="unknown"]')).not.toBeNull();
  });

  it('formats the last-ingested instant with the shared date:short idiom', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    const cell = el.querySelector('[data-phone-id="phone-a1b2c3"] .p-last-ingested')!;
    expect(cell.textContent!.trim())
      .toBe(formatDate('2026-07-18T09:30:00Z', 'short', 'en-US'));
  });

  it('renders an empty state when no phones have ingested yet', async () => {
    bff.phones.and.resolveTo([]);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="pf-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="pf-empty"]')!.textContent)
      .toContain('No phones have ingested yet');
    expect(el.querySelector('[data-testid="pf-table"]')).toBeNull();
  });

  it('surfaces a network-level load failure in the role=alert region', async () => {
    bff.phones.and.rejectWith(new Error('NetworkError when attempting to fetch resource'));
    await init();

    expect(component.loadError()).toContain('NetworkError');
    expect(component.loading()).toBeFalse();
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="pf-error"]')!;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    // A failed load renders neither the table nor the (mutually exclusive) empty state.
    expect(el.querySelector('[data-testid="pf-table"]')).toBeNull();
    expect(el.querySelector('[data-testid="pf-empty"]')).toBeNull();
  });

  it('re-fetches the fleet when Refresh is clicked and clears a previous error', async () => {
    bff.phones.and.rejectWith(new Error('boom'));
    await init();
    expect(component.loadError()).toBe('boom');

    bff.phones.and.resolveTo(fixturePhones());
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="pf-refresh"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.phones).toHaveBeenCalledTimes(2);
    expect(component.loadError()).toBe('');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="pf-error"]')).toBeNull();
    expect(el.querySelectorAll('[data-phone-id]').length).toBe(2);
  });

  it('expands a row into the full record and collapses it again', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-phone-detail="phone-a1b2c3"]')).toBeNull();

    clickExpand('phone-a1b2c3');
    const detail = el.querySelector('[data-phone-detail="phone-a1b2c3"]')!;
    expect(detail).not.toBeNull();
    // Identity block.
    expect(detail.textContent).toContain('row-1');
    expect(detail.textContent).toContain('SER-0001');
    expect(detail.textContent).toContain('komodo');
    // Mesh/tailscale block.
    expect(detail.textContent).toContain('snapdragon.systems');
    expect(detail.textContent).toContain('phone-a1b2c3');
    // Enterprise-profile block.
    expect(detail.textContent).toContain('device');
    expect(detail.textContent).toContain('10');
    // Attestation block.
    expect(detail.textContent).toContain('systems.snapdragon.auditor');
    expect(detail.textContent).toContain('verified');
    // Ingest telemetry: first/last ingested + count.
    expect(detail.textContent).toContain(formatDate('2026-07-01T10:05:00Z', 'short', 'en-US'));
    expect(detail.textContent).toContain(formatDate('2026-07-18T09:30:00Z', 'short', 'en-US'));
    expect(detail.textContent).toContain('42');

    clickExpand('phone-a1b2c3');
    expect(el.querySelector('[data-phone-detail="phone-a1b2c3"]')).toBeNull();
  });

  it('keeps at most one detail row open (expanding another row collapses the first)', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;

    clickExpand('phone-a1b2c3');
    clickExpand('phone-d4e5f6');

    expect(el.querySelector('[data-phone-detail="phone-a1b2c3"]')).toBeNull();
    expect(el.querySelector('[data-phone-detail="phone-d4e5f6"]')).not.toBeNull();
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="phone-fleet-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('pf-heading');
      expect(el.querySelector('#pf-heading')).not.toBeNull();
    });

    it('names the fleet table (aria-labelledby + sr caption) and scopes every header column', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const table = el.querySelector('[data-testid="pf-table"]')!;
      expect(table.getAttribute('aria-labelledby')).toBe('pf-heading');
      expect(table.querySelector('caption')).not.toBeNull();
      const headers = table.querySelectorAll('thead th');
      expect(headers.length).toBe(10);
      for (const th of Array.from(headers)) {
        expect(th.getAttribute('scope')).toBe('col');
      }
    });

    it('drives each expand button with aria-expanded + aria-controls onto the detail row', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const button = el.querySelector('[data-expand="phone-a1b2c3"]')!;
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBe('pf-detail-phone-a1b2c3');
      expect(button.getAttribute('aria-label')).toContain('phone-a1b2c3');

      clickExpand('phone-a1b2c3');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      // The controls id resolves to the rendered detail cell.
      expect(el.querySelector('#pf-detail-phone-a1b2c3')).not.toBeNull();
    });

    it('announces the loading state politely in role=status', async () => {
      fixture.detectChanges();   // ngOnInit fired, phones() still pending
      const el: HTMLElement = fixture.nativeElement;
      const status = el.querySelector('[data-testid="pf-loading"]')!;
      expect(status).not.toBeNull();
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      await init();
      expect(el.querySelector('[data-testid="pf-loading"]')).toBeNull();
    });
  });
});
