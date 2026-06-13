import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FocusTrapDirective } from './focus-trap.directive';

/**
 * FocusTrapDirective tests — the WAI-ARIA APG modal-dialog keyboard contract:
 * focus moves INTO the dialog on open, Tab/Shift+Tab WRAP inside it (no escape,
 * WCAG 2.1.2 intentional-modal), Escape emits dismiss, and on close focus is
 * RESTORED to the trigger that opened it.
 */
@Component({
  standalone: true,
  imports: [CommonModule, FocusTrapDirective],
  template: `
    <button type="button" id="trigger" (click)="open.set(true)">Open</button>
    <div
      *ngIf="open()"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      snapFocusTrap
      (dismiss)="open.set(false)"
    >
      <button type="button" id="first">First</button>
      <button type="button" id="last">Last</button>
    </div>
  `,
})
class HostComponent {
  readonly open = signal(false);
}

describe('FocusTrapDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  function $(id: string): HTMLElement {
    return fixture.nativeElement.querySelector('#' + id);
  }
  /** Open the dialog (focus must already be on the trigger to test restore). */
  async function openDialog(): Promise<void> {
    host.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('moves focus into the dialog (first focusable) when opened', async () => {
    $('trigger').focus();
    await openDialog();
    expect(document.activeElement).toBe($('first'));
  });

  it('Escape emits dismiss so the host closes the dialog', async () => {
    $('trigger').focus();
    await openDialog();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.open()).toBeFalse();
  });

  it('restores focus to the trigger when the dialog closes', async () => {
    $('trigger').focus();
    await openDialog();
    host.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe($('trigger'));
  });

  it('Tab from the last focusable wraps to the first (trap)', async () => {
    $('trigger').focus();
    await openDialog();
    $('last').focus();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe($('first'));
  });

  it('Shift+Tab from the first focusable wraps to the last (trap)', async () => {
    $('trigger').focus();
    await openDialog();
    $('first').focus();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe($('last'));
  });
});
