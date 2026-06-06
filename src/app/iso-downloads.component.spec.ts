import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IsoDownloadsComponent } from './iso-downloads.component';
import { BffService } from './bff.service';

describe('IsoDownloadsComponent', () => {
  let fixture: ComponentFixture<IsoDownloadsComponent>;
  let component: IsoDownloadsComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['isos']);
    await TestBed.configureTestingModule({
      imports: [IsoDownloadsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(IsoDownloadsComponent);
    component = fixture.componentInstance;
  });

  it('loads ISOs on init and renders a download link per artifact', async () => {
    bff.isos.and.resolveTo([{ name: 'snapdragon-1.0.iso', url: 'https://dl/iso/1' }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.isos).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector<HTMLAnchorElement>('[data-iso="snapdragon-1.0.iso"] a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://dl/iso/1');
    expect(link!.hasAttribute('download')).toBeTrue();
  });

  it('shows the empty-state message when no ISOs are delivered', async () => {
    bff.isos.and.resolveTo([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="iso-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="iso-list"] li')).toBeNull();
  });

  describe('accessibility', () => {
    it('labels the download list and gives each link screen-reader context', async () => {
      bff.isos.and.resolveTo([{ name: 'a.iso', url: 'u' }]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const list = el.querySelector('[data-testid="iso-list"]')!;
      expect(list.getAttribute('aria-label')).withContext('list is labelled').toBeTruthy();
      const srText = el.querySelector('[data-iso="a.iso"] a .sr');
      expect(srText).withContext('screen-reader-only download hint present').not.toBeNull();
    });
  });
});
