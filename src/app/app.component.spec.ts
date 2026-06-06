import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { routes } from './app.routes';

/**
 * The standalone dev shell (only used by `ng serve admin`). It must supply the
 * a11y landmarks that the federated host normally provides — a skip link and a
 * focusable <main id="main"> — plus the <router-outlet> that mounts the exposed
 * ADMIN_ROUTES so the remote is browsable on its own.
 */
describe('AppComponent (standalone dev shell)', () => {
  let fixture: ComponentFixture<AppComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter(routes)],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('creates the dev shell', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a router-outlet so ADMIN_ROUTES can mount standalone', () => {
    expect(el.querySelector('router-outlet')).not.toBeNull();
  });

  describe('accessibility', () => {
    it('exposes a skip link targeting the main landmark', () => {
      const skip = el.querySelector<HTMLAnchorElement>('a.skip');
      expect(skip).withContext('skip link present').not.toBeNull();
      expect(skip!.getAttribute('href')).toBe('#main');
      expect(skip!.textContent!.trim().length).toBeGreaterThan(0);
    });

    it('renders a focusable <main id="main"> landmark for the skip target', () => {
      const main = el.querySelector<HTMLElement>('main#main');
      expect(main).withContext('<main id="main"> present').not.toBeNull();
      expect(main!.getAttribute('tabindex')).toBe('-1');
    });
  });
});
