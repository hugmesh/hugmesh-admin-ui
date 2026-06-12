import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminTaskWizardComponent } from './admin-task-wizard.component';
import { BffService, TaskDef } from './bff.service';

describe('AdminTaskWizardComponent', () => {
  let fixture: ComponentFixture<AdminTaskWizardComponent>;
  let component: AdminTaskWizardComponent;
  let bff: jasmine.SpyObj<BffService>;

  const gatewayRoute: TaskDef = {
    id: 'gateway-route',
    title: 'Add a gateway route',
    description: 'Define a path prefix → downstream service.',
    steps: [
      { id: 'define', title: 'Define the route', fields: [
        { key: 'pathPrefix', label: 'Path prefix', type: 'text', required: true, placeholder: '/api/widgets/',
          hint: 'The URL path the gateway matches, e.g. /api/widgets/.' },
        { key: 'downstreamUri', label: 'Downstream URI', type: 'text', required: true, placeholder: 'http://x' },
      ] },
      { id: 'confirm', title: 'Review & apply', fields: [] },
    ],
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['adminTasks', 'validateStep', 'previewStep', 'applyStep']);
    bff.adminTasks.and.resolveTo([gatewayRoute]);
    await TestBed.configureTestingModule({
      imports: [AdminTaskWizardComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminTaskWizardComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists the available tasks from the BFF', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-task="gateway-route"]')).not.toBeNull();
  });

  it('renders the chosen task\'s data-driven fields with <label for>', async () => {
    await init();
    component.chooseTask('gateway-route');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#f-pathPrefix')).not.toBeNull();
    expect(el.querySelector('label[for="f-pathPrefix"]')).not.toBeNull();
    expect(el.querySelector('#f-downstreamUri')).not.toBeNull();
  });

  it('validates a step and surfaces an inline field error in role=alert; blocks Next', async () => {
    bff.validateStep.and.resolveTo({
      valid: false,
      errors: [{ field: 'pathPrefix', message: "pathPrefix '/**' has no addressable first path segment" }],
      warnings: [],
    });
    await init();
    component.chooseTask('gateway-route');
    component.setField('pathPrefix', '/**');

    await component.next();
    fixture.detectChanges();

    expect(bff.validateStep).toHaveBeenCalledWith('gateway-route', 'define', jasmine.any(Object));
    // Invalid → stays on step 0.
    expect(component.stepIndex()).toBe(0);
    const el: HTMLElement = fixture.nativeElement;
    const err = el.querySelector('[data-error="pathPrefix"]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('addressable');
  });

  it('advances to the next step when validation passes', async () => {
    bff.validateStep.and.resolveTo({ valid: true, errors: [], warnings: [] });
    await init();
    component.chooseTask('gateway-route');
    component.setField('pathPrefix', '/widgets/');
    component.setField('downstreamUri', 'http://widgets:8080');

    await component.next();
    fixture.detectChanges();

    expect(component.stepIndex()).toBe(1);
    expect(component.isLastStep()).toBeTrue();
  });

  it('surfaces non-blocking warnings in a polite live region', async () => {
    bff.validateStep.and.resolveTo({
      valid: true, errors: [], warnings: ["route prefix 'widgets' is NOT in the reserved username list"],
    });
    await init();
    component.chooseTask('gateway-route');
    await component.validate();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const warn = el.querySelector('[data-testid="wizard-warnings"]')!;
    expect(warn.getAttribute('aria-live')).toBe('polite');
    expect(warn.textContent).toContain('widgets');
  });

  it('previews then applies on the final step, delegating to the BFF', async () => {
    bff.validateStep.and.resolveTo({ valid: true, errors: [], warnings: [] });
    bff.previewStep.and.resolveTo({
      summary: "Route '/widgets/' → 'http://widgets:8080' will be upserted.",
      changes: ['upsert url_registry'], validation: { valid: true, errors: [], warnings: [] },
    });
    bff.applyStep.and.resolveTo({ applied: true, message: 'route upserted', data: {} });
    await init();
    component.chooseTask('gateway-route');
    component.setField('pathPrefix', '/widgets/');
    component.setField('downstreamUri', 'http://widgets:8080');
    await component.next(); // → final step

    await component.runPreview();
    fixture.detectChanges();
    let el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="wizard-preview-box"]')!.textContent).toContain('upserted');

    await component.apply();
    fixture.detectChanges();
    el = fixture.nativeElement;
    expect(bff.applyStep).toHaveBeenCalledWith('gateway-route', 'define', jasmine.any(Object));
    const result = el.querySelector('[data-testid="wizard-apply-result"]')!;
    expect(result.textContent).toContain('route upserted');
    expect(result.classList).toContain('ok');
  });

  describe('help text (sighted + low/no-sight)', () => {
    it('renders a persistent field hint and wires it to the input via aria-describedby', async () => {
      await init();
      component.chooseTask('gateway-route');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;

      const hint = el.querySelector('[data-hint="pathPrefix"]')!;
      expect(hint).withContext('persistent field hint rendered').not.toBeNull();
      expect(hint.id).toBe('hint-pathPrefix');
      expect(hint.textContent).toContain('gateway matches');

      const input = el.querySelector('#f-pathPrefix')!;
      expect(input.getAttribute('aria-describedby')).toBe('hint-pathPrefix');

      // A field without a hint gets no describedby (no aria spam).
      expect(el.querySelector('#f-downstreamUri')!.getAttribute('aria-describedby')).toBeNull();
    });

    it('combines the field hint and the inline error in aria-describedby when both exist', async () => {
      bff.validateStep.and.resolveTo({
        valid: false,
        errors: [{ field: 'pathPrefix', message: 'reserved prefix' }],
        warnings: [],
      });
      await init();
      component.chooseTask('gateway-route');
      component.setField('pathPrefix', '/api/');
      await component.validate();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const input = el.querySelector('#f-pathPrefix')!;
      expect(input.getAttribute('aria-describedby')).toBe('hint-pathPrefix err-pathPrefix');
    });

    it('describes the consequential Validate / Preview / Apply actions with help that exists', async () => {
      bff.validateStep.and.resolveTo({ valid: true, errors: [], warnings: [] });
      await init();
      component.chooseTask('gateway-route');
      component.setField('pathPrefix', '/widgets/');
      component.setField('downstreamUri', 'http://widgets:8080');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const validate = el.querySelector<HTMLButtonElement>('[data-testid="wizard-validate"]')!;
      expect(validate.getAttribute('aria-describedby')).toBe('wizard-validate-help');
      expect(el.querySelector('#wizard-validate-help')!.textContent).toContain('without');

      await component.next(); // → final step renders preview/apply
      fixture.detectChanges();
      const preview = el.querySelector<HTMLButtonElement>('[data-testid="wizard-preview"]')!;
      expect(preview.getAttribute('aria-describedby')).toBe('wizard-preview-help');
      const apply = el.querySelector<HTMLButtonElement>('[data-testid="wizard-apply"]')!;
      expect(apply.getAttribute('aria-describedby')).toBe('wizard-apply-help');
      expect(el.querySelector('#wizard-apply-help')!.textContent).toContain('Commits');
    });
  });
});
