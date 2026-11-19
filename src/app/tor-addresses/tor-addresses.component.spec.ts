import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BffService, TorNodeView } from '../bff.service';
import { TOR_RENEW_WARNING, TorAddressesComponent } from './tor-addresses.component';

const A = 'a'.repeat(56) + '.onion';
const S = 's'.repeat(56) + '.onion';
const B = 'b'.repeat(56) + '.onion';

function node(domains: Record<string, string>, primary: string | null = A): TorNodeView {
  return { node: 'fp-1', registered: true, primary, domains };
}

describe('TorAddressesComponent (hugmesh-generator#652)', () => {
  let fixture: ComponentFixture<TorAddressesComponent>;
  let bff: jasmine.SpyObj<BffService>;
  const el = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  async function make(nodes: TorNodeView[] | Error) {
    bff = jasmine.createSpyObj<BffService>('BffService', ['torNodes', 'torRequestNewAddress']);
    if (nodes instanceof Error) bff.torNodes.and.rejectWith(nodes);
    else bff.torNodes.and.resolveTo(nodes);
    await TestBed.configureTestingModule({
      imports: [TorAddressesComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(TorAddressesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(id: string, value: string) {
    const input = el(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists each domain once with every address the nodes reported, and the mesh own address apart', async () => {
    await make([node({ shop: S, brandb: B }), node({ shop: S })]);
    expect(el('tor-row-brandb')).toBeTruthy();
    expect(el('tor-row-shop')!.textContent).toContain(S);
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="tor-row-"]').length).toBe(2);
    expect(el('tor-primary')!.textContent).toContain(A);
    // the mesh's own address has no New address button
    expect(el('tor-primary')!.querySelector('button')).toBeNull();
  });

  it('asks first: nothing is sent until the domain key is typed again', async () => {
    await make([node({ shop: S })]);
    el('tor-ask-shop')!.click();
    fixture.detectChanges();
    expect(el('tor-confirm-shop')!.textContent).toContain(TOR_RENEW_WARNING);
    const go = el('tor-go-shop') as HTMLButtonElement;
    expect(go.disabled).toBeTrue();
    await type('tor-typed-shop', 'shopp');
    expect((el('tor-go-shop') as HTMLButtonElement).disabled).toBeTrue();
    expect(bff.torRequestNewAddress).not.toHaveBeenCalled();
  });

  it('Cancel closes the confirmation and sends nothing', async () => {
    await make([node({ shop: S })]);
    el('tor-ask-shop')!.click();
    fixture.detectChanges();
    el('tor-cancel-shop')!.click();
    fixture.detectChanges();
    expect(el('tor-confirm-shop')).toBeNull();
    expect(bff.torRequestNewAddress).not.toHaveBeenCalled();
  });

  it('with the key retyped, sends the request for THAT domain and says what happens next', async () => {
    await make([node({ shop: S, brandb: B })]);
    bff.torRequestNewAddress.and.resolveTo({ domain: 'shop', requestCount: 2, status: 'requested' });
    el('tor-ask-shop')!.click();
    fixture.detectChanges();
    await type('tor-typed-shop', 'shop');
    (el('tor-go-shop') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(bff.torRequestNewAddress).toHaveBeenCalledOnceWith('shop', 'shop');
    expect(el('tor-notice-shop')!.textContent).toContain('request 2');
    expect(el('tor-confirm-shop')).toBeNull();
    expect(el('tor-notice-brandb')).toBeNull();
  });

  it('shows a refusal inline and keeps the confirmation for another try', async () => {
    await make([node({ shop: S })]);
    bff.torRequestNewAddress.and.rejectWith(new Error('Not your domain.'));
    el('tor-ask-shop')!.click();
    fixture.detectChanges();
    await type('tor-typed-shop', 'shop');
    (el('tor-go-shop') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el('tor-error-shop')!.textContent).toContain('Not changed: Not your domain.');
    expect(el('tor-notice-shop')).toBeNull();
  });

  it('says so when no domain has its own address, and when the list cannot be read', async () => {
    await make([node({})]);
    expect(el('tor-empty')).toBeTruthy();
    TestBed.resetTestingModule();
    await make(new Error('HTTP 503'));
    expect(el('tor-load-error')!.textContent).toContain('HTTP 503');
    expect(el('tor-empty')).toBeNull();
  });
});
