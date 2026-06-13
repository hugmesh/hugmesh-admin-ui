import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RovingFocusDirective } from './roving-focus.directive';

/**
 * RovingFocusDirective tests — the WAI-ARIA APG roving-tabindex composite-widget
 * keyboard contract (tablist / toolbar): exactly one item tabbable, Arrow / Home /
 * End move the roving focus and wrap, and a Tab-in re-syncs the tabbable item.
 */
@Component({
  standalone: true,
  imports: [RovingFocusDirective],
  template: `
    <div role="tablist" snapRovingFocus>
      <button type="button" role="tab" [attr.aria-selected]="active === 0" data-i="0">One</button>
      <button type="button" role="tab" [attr.aria-selected]="active === 1" data-i="1">Two</button>
      <button type="button" role="tab" [attr.aria-selected]="active === 2" data-i="2">Three</button>
    </div>
  `,
})
class HostComponent {
  active = 0;
}

describe('RovingFocusDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let buttons: HTMLButtonElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement); // real focus needs an attached DOM
    fixture.detectChanges();
    await fixture.whenStable();
    buttons = Array.from(fixture.nativeElement.querySelectorAll('button'));
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  function key(name: string, target: HTMLElement): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    fixture.detectChanges();
  }

  it('makes exactly one item tabbable (the selected one), the rest tabindex -1', () => {
    expect(buttons[0].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);
    expect(buttons[2].tabIndex).toBe(-1);
  });

  it('ArrowRight moves roving focus to the next item and updates tabindex', () => {
    buttons[0].focus();
    key('ArrowRight', buttons[0]);
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);
  });

  it('ArrowLeft from the first item wraps to the last', () => {
    buttons[0].focus();
    key('ArrowLeft', buttons[0]);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('ArrowRight from the last item wraps to the first', () => {
    buttons[2].focus();
    key('ArrowRight', buttons[2]);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('Home focuses the first, End focuses the last', () => {
    buttons[1].focus();
    key('End', buttons[1]);
    expect(document.activeElement).toBe(buttons[2]);
    key('Home', buttons[2]);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('skips disabled / aria-disabled items', () => {
    buttons[1].setAttribute('aria-disabled', 'true');
    fixture.detectChanges();
    buttons[0].focus();
    key('ArrowRight', buttons[0]);
    expect(document.activeElement).toBe(buttons[2]);
  });
});
