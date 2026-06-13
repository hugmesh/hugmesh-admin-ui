import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, OnDestroy, Output, inject } from '@angular/core';

/** Selector for the natively-focusable, non-disabled, in-flow descendants. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus-management for a `role="dialog" aria-modal="true"` element, to the
 * WAI-ARIA APG modal-dialog pattern + WCAG 2.1.2 (No Keyboard Trap, with the
 * intentional-modal exception that MUST be Escape-closable and MUST restore focus):
 *
 * <ul>
 *   <li>On open, focus moves INTO the dialog (the first focusable control).</li>
 *   <li>Tab / Shift+Tab WRAP inside the dialog — focus cannot leave it.</li>
 *   <li>Escape emits {@code dismiss} so the host closes the dialog.</li>
 *   <li>On destroy (close), focus is RESTORED to the element that was focused
 *       when the dialog opened (the trigger), so the keyboard user is put back
 *       exactly where they were — never stranded on a removed element.</li>
 * </ul>
 *
 * The host binds {@code (dismiss)} to its close/cancel action. This is the only
 * intentional focus-trap in the app and it satisfies every escape condition.
 */
@Directive({
  selector: '[snapFocusTrap]',
  standalone: true,
})
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Emitted on Escape so the host dismisses the dialog. */
  @Output('dismiss') readonly dismiss = new EventEmitter<void>();

  /** The control that had focus when the dialog opened, restored on close. */
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      const first = this.focusable()[0] ?? this.host.nativeElement;
      first.focus();
    });
  }

  ngOnDestroy(): void {
    // Restore focus to the trigger so a keyboard user is never stranded.
    this.previouslyFocused?.focus?.();
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismiss.emit();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = this.focusable();
    if (items.length === 0) {
      // Nothing focusable but the dialog itself — keep focus on it.
      event.preventDefault();
      this.host.nativeElement.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !this.host.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
