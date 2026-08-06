import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteAccessComponent } from './route-access.component';
import { BffService } from './bff.service';

/**
 * THE gateway-vocabulary pin for the Gateway-access console.
 *
 * WHY THIS EXISTS. A `gateway_route_access` row is loaded by exactly one gateway:
 * the instance whose OWN `instance.name` equals the row's `gateway` column. A row
 * naming anything else is accepted by admin-bff (`RouteRuleRequest` bounds the
 * field @NotBlank @Size(max=255) and nothing more), stored in Postgres, mirrored
 * to Cassandra — and read by NOBODY. It fails silently, forever, and the console
 * shows it sitting in the table as though it were live.
 *
 * That is what shipped: the console's dropdown offered `snapdragon-pki-gateway` /
 * `snapdragon-be-gateway` / `snapdragon-fe-gateway`, names that no deployed
 * instance has carried since the HugMesh rebrand. Every rule written from this
 * console — including every per-route `mfa_required` floor made editable by the
 * MFA-column change — targeted a gateway that does not exist.
 *
 * Because admin-bff does not constrain the value, THIS UI list is the only place
 * the vocabulary is enforced, and the names live in a DIFFERENT repo. So they are
 * PINNED literally below and asserted as a WHOLE SET: a missing name (an instance
 * the console can no longer administer) and an unexpected name (a rule that will
 * never be enforced) both fail.
 *
 * SOURCE OF TRUTH — hugmesh-generator @ main:
 *   specs/cluster/apps/20-gateway-pki.yaml         helm.values instance.name: hugmesh-pki-gateway
 *   specs/cluster/apps/20-gateway-be.yaml          helm.values instance.name: hugmesh-be-gateway
 *   specs/cluster/apps/20-gateway-fe.yaml          helm.values instance.name: hugmesh-fe-gateway
 *   specs/cluster/apps/22-gateway-superadmin.yaml  helm.values instance.name: hugmesh-superadmin-gateway
 * Cross-checked against the seeded rows in
 *   specs/cluster/manifests/route-access/initdb/20-schema.sql
 * which insert under exactly these four literals and no others.
 *
 * WHEN A GATEWAY IS ADDED/REMOVED/RENAMED IN THE GENERATOR: update BOTH the
 * pinned list here and `DEPLOYED_GATEWAYS` in route-access.component.ts, in the
 * same change. Editing only the component is what this spec exists to stop.
 *
 * Deliberately asserts through the component's PUBLIC surface only (the rendered
 * <select>, `component.gateways`, `component.gateway`, `add()`), importing no
 * vocabulary constant from the code under test — a pin that imports the value it
 * is pinning proves nothing, and this way the spec also compiles (and goes red)
 * against the pre-fix tree.
 */
describe('Gateway-access vocabulary (pinned to the deployed gateway instances)', () => {
  /** The four deployed instance names, copied by hand from the generator (above). */
  const DEPLOYED_INSTANCE_NAMES = [
    'hugmesh-pki-gateway',
    'hugmesh-be-gateway',
    'hugmesh-fe-gateway',
    'hugmesh-superadmin-gateway',
  ];

  /** The pre-rebrand prefix. No deployed instance carries it; a rule naming one is inert. */
  const RETIRED_PREFIX = 'snapdragon-';

  let fixture: ComponentFixture<RouteAccessComponent>;
  let component: RouteAccessComponent;
  let bff: jasmine.SpyObj<BffService>;

  const sorted = (xs: readonly string[]) => [...xs].sort();

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['routeAccess', 'addRouteRule', 'removeRouteRule']);
    bff.routeAccess.and.resolveTo([]);
    await TestBed.configureTestingModule({
      imports: [RouteAccessComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteAccessComponent);
    component = fixture.componentInstance;
  });

  // ── 1. the set itself ────────────────────────────────────────────────────────

  it('offers EXACTLY the deployed gateway instances — no name missing, none extra', () => {
    // Set equality, not "contains": a dropped instance (unadministrable) and an
    // invented instance (unenforceable rules) are both failures.
    expect(sorted(component.gateways))
      .withContext(
        'admin-ui gateway vocabulary has drifted from hugmesh-generator ' +
        'specs/cluster/apps/2*-gateway-*.yaml `instance.name`. Rules written for a ' +
        'name no gateway carries are stored and never enforced.')
      .toEqual(sorted(DEPLOYED_INSTANCE_NAMES));
  });

  it('names no gateway with the retired snapdragon- prefix (the shipped regression)', () => {
    const retired = component.gateways.filter((g) => g.startsWith(RETIRED_PREFIX));
    expect(retired)
      .withContext('pre-rebrand gateway name(s) — no deployed instance answers to these')
      .toEqual([]);
  });

  it('every offered name has the deployed hugmesh-<tier>-gateway shape', () => {
    for (const g of component.gateways) {
      expect(g).withContext(g).toMatch(/^hugmesh-[a-z0-9]+(-[a-z0-9]+)*-gateway$/);
    }
  });

  // ── 2. the default the operator writes with if they touch nothing ────────────

  it('defaults to a DEPLOYED gateway, so an untouched form writes an enforceable rule', () => {
    expect(DEPLOYED_INSTANCE_NAMES)
      .withContext(`the add form pre-selects "${component.gateway}"`)
      .toContain(component.gateway);
  });

  it('sends a deployed instance name on the wire when the form is submitted untouched', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.addRouteRule.and.resolveTo([]);

    component.urlPattern = '/api/x/**';
    component.role = 'ROLE_USER';
    await component.add();

    expect(bff.addRouteRule)
      .withContext('the untouched add form did not reach the BFF at all')
      .toHaveBeenCalled();
    const sent = bff.addRouteRule.calls.mostRecent()?.args[0] as { gateway: string } | undefined;
    expect(DEPLOYED_INSTANCE_NAMES)
      .withContext(`console POSTed gateway="${sent?.gateway}" — not a deployed instance`)
      .toContain(sent?.gateway as string);
  });

  // ── 3. the template cannot drift from the model ──────────────────────────────

  it('renders one <option> per deployed instance and nothing else', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const options = Array.from(el.querySelectorAll<HTMLOptionElement>('#ra-gateway option'));
    expect(sorted(options.map((o) => o.value))).toEqual(sorted(DEPLOYED_INSTANCE_NAMES));
    expect(sorted(options.map((o) => o.textContent!.trim()))).toEqual(sorted(DEPLOYED_INSTANCE_NAMES));
  });

  // ── 4. the write-side gate ───────────────────────────────────────────────────

  it('refuses to write a rule for an undeployed gateway and never calls the BFF', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.addRouteRule.calls.reset();

    // A plausible-but-wrong name: `hugmesh-id-gateway` is the pki gateway's OLD
    // identity (still referenced in generator docs), so it is exactly the sort of
    // value a well-meaning prefill would carry.
    component.gateway = 'hugmesh-id-gateway';
    component.urlPattern = '/api/x/**';
    component.role = 'ROLE_USER';
    await component.add();
    fixture.detectChanges();

    expect(bff.addRouteRule).not.toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="ra-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('hugmesh-id-gateway');
    expect(component.formError()).toContain('never enforced');
  });
});
