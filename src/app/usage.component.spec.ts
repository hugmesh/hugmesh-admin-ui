import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsageComponent } from './usage.component';
import { BffService } from './bff.service';

describe('UsageComponent', () => {
  let fixture: ComponentFixture<UsageComponent>;
  let component: UsageComponent;
  let bff: jasmine.SpyObj<BffService>;

  const usage = {
    activeUsers: 7,
    totalEvents: 42,
    byModule: [{ module: 'games', events: 30, users: 5 }],
    byAction: [{ action: 'login', events: 12 }],
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['usage']);
    bff.usage.and.resolveTo(usage);
    await TestBed.configureTestingModule({
      imports: [UsageComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(UsageComponent);
    component = fixture.componentInstance;
  });

  it('loads usage on init and renders the summary counts', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.usage).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="usage-active"]')!.textContent!.trim()).toBe('7');
    expect(el.querySelector('[data-testid="usage-total"]')!.textContent!.trim()).toBe('42');
    expect(el.querySelector('[data-module="games"]')).not.toBeNull();
    expect(el.querySelector('[data-action="login"]')).not.toBeNull();
  });

  it('shows zeroed counts before data arrives (null-safe template)', () => {
    fixture.detectChanges(); // ngOnInit kicked off but not awaited
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="usage-active"]')!.textContent!.trim()).toBe('0');
    expect(el.querySelector('[data-testid="usage-total"]')!.textContent!.trim()).toBe('0');
  });

  describe('accessibility', () => {
    it('labels each data table via aria-labelledby pointing at a real heading', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['usage-by-module', 'usage-by-action']) {
        const table = el.querySelector(`[data-testid="${id}"]`)!;
        const labelledBy = table.getAttribute('aria-labelledby');
        expect(labelledBy).withContext(`${id} aria-labelledby`).not.toBeNull();
        expect(el.querySelector(`#${labelledBy}`)).withContext(`heading #${labelledBy}`).not.toBeNull();
      }
    });

    it('uses semantic column headers (th[scope=col]) inside a thead', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const cols = el.querySelectorAll('table thead th[scope="col"]');
      expect(cols.length).toBeGreaterThanOrEqual(5);
    });
  });
});
