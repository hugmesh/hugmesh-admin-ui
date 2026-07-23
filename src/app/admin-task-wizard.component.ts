import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, TaskDef, StepDef, FieldDef, ValidationResult, PreviewResult, ApplyResult } from './bff.service';

/**
 * Admin "Guided tasks" wizard (ROLE_ADMIN only, route-guarded). A step/task UX over
 * the unified /bff/admin/tasks/** surface: pick a task, then per step run
 * validate → preview → apply with inline validation and a progress indicator. The
 * task definitions (steps + fields) are DATA-DRIVEN from the BFF, so a new admin
 * task added server-side appears here with no UI change.
 *
 * <p>Wraps the existing cluster-admin operations (gateway-route, RBAC/route-access,
 * Casdoor user) behind one guided flow, reusing the BFF's ReservedNames validation
 * (a reserved path/username is surfaced as an inline field error before apply).
 *
 * <p>a11y: the wizard is keyboard operable (native form controls + buttons), each
 * field has a &lt;label for&gt;, inline errors are in role=alert live regions, and
 * the progress is announced via an aria-live status.
 */
@Component({
  selector: 'hug-admin-task-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-task-wizard.component.html',
  styleUrl: './admin-task-wizard.component.scss',
})
export class AdminTaskWizardComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly tasks = signal<TaskDef[]>([]);
  readonly task = signal<TaskDef | null>(null);
  readonly stepIndex = signal(0);
  /** Per-step form input, keyed by field key. Reset when a task is chosen. */
  readonly form = signal<Record<string, unknown>>({});
  readonly validation = signal<ValidationResult | null>(null);
  readonly preview = signal<PreviewResult | null>(null);
  readonly applied = signal<ApplyResult | null>(null);
  readonly busy = signal(false);

  readonly currentStep = computed<StepDef | null>(() => {
    const t = this.task();
    return t ? (t.steps[this.stepIndex()] ?? null) : null;
  });
  readonly isLastStep = computed(() => {
    const t = this.task();
    return !!t && this.stepIndex() >= t.steps.length - 1;
  });

  async ngOnInit(): Promise<void> { this.tasks.set(await this.bff.adminTasks()); }

  /** Choose a task → reset the wizard to its first step. */
  chooseTask(id: string): void {
    const t = this.tasks().find((x) => x.id === id) ?? null;
    this.task.set(t);
    this.stepIndex.set(0);
    this.form.set({});
    this.validation.set(null);
    this.preview.set(null);
    this.applied.set(null);
  }

  setField(key: string, value: unknown): void {
    this.form.set({ ...this.form(), [key]: value });
    // A change invalidates a stale preview/validation for the current step.
    this.validation.set(null);
    this.preview.set(null);
  }

  fieldError(key: string): string | null {
    const v = this.validation();
    if (!v) return null;
    return v.errors.find((e) => e.field === key)?.message ?? null;
  }

  /**
   * The space-separated `aria-describedby` for a field: its persistent help hint
   * (when the field defines one) plus its inline error (when present), so a
   * screen reader announces BOTH the field's purpose and any validation problem.
   * Returns null when there is nothing to describe (no aria-describedby spam).
   */
  describedBy(field: FieldDef): string | null {
    const ids: string[] = [];
    if (field.hint) ids.push('hint-' + field.key);
    if (this.fieldError(field.key)) ids.push('err-' + field.key);
    return ids.length ? ids.join(' ') : null;
  }

  /** Validate the current step's inputs (no change). */
  async validate(): Promise<ValidationResult | null> {
    const t = this.task(); const step = this.currentStep();
    if (!t || !step) return null;
    this.busy.set(true);
    const v = await this.bff.validateStep(t.id, step.id, this.form());
    this.validation.set(v);
    this.busy.set(false);
    return v;
  }

  /** Validate, then advance to the next step (blocked when invalid). */
  async next(): Promise<void> {
    const v = await this.validate();
    if (v?.valid && !this.isLastStep()) {
      this.stepIndex.set(this.stepIndex() + 1);
      this.preview.set(null);
    }
  }

  back(): void {
    if (this.stepIndex() > 0) {
      this.stepIndex.set(this.stepIndex() - 1);
      this.validation.set(null);
      this.preview.set(null);
    }
  }

  /** Preview what apply would do for the FIRST (input) step of the task. */
  async runPreview(): Promise<void> {
    const t = this.task();
    if (!t) return;
    this.busy.set(true);
    this.preview.set(await this.bff.previewStep(t.id, t.steps[0].id, this.form()));
    this.busy.set(false);
  }

  /** Apply the task (delegates server-side to the existing admin service). */
  async apply(): Promise<void> {
    const t = this.task();
    if (!t) return;
    this.busy.set(true);
    const result = await this.bff.applyStep(t.id, t.steps[0].id, this.form());
    this.applied.set(result);
    this.busy.set(false);
  }
}
