import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkloadConsoleComponent } from './workload-console.component';
import { BffService, WorkloadPod } from '../bff.service';
import { SessionService } from '../session.service';

function pod(name: string, ns = 'hugmesh-backend'): WorkloadPod {
  return {
    namespace: ns, name, workload: name.replace(/-[0-9a-f]+$/, ''), phase: 'Running',
    ready: true, restarts: 0, node: 'pi-1', startedAt: null, containers: [],
  };
}

describe('WorkloadConsoleComponent', () => {
  let fixture: ComponentFixture<WorkloadConsoleComponent>;
  let component: WorkloadConsoleComponent;
  let bff: jasmine.SpyObj<BffService>;
  let session: jasmine.SpyObj<SessionService>;

  function configure(superadmin: boolean) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'workloadCapability', 'workloadPods', 'workloadAllPods', 'workloadInspect',
      'workloadMetrics', 'workloadEvents', 'workloadStorage', 'workloadNetwork', 'workloadLogs',
      'workloadRolloutRestart', 'workloadDeletePod', 'workloadStepUp', 'workloadGrants',
      'workloadGrant', 'workloadRevokeGrant', 'workloadConfig', 'workloadPutConfig',
      'workloadPendingIntents',
    ]);
    bff.workloadCapability.and.resolveTo({ enabled: true, readOnly: !superadmin, domain: 'brandx' });
    bff.workloadPods.and.resolveTo([pod('web-abc'), pod('api-def')]);
    bff.workloadAllPods.and.resolveTo([pod('web-abc')]);
    bff.workloadGrants.and.resolveTo([]);
    bff.workloadConfig.and.resolveTo([]);
    bff.workloadPendingIntents.and.resolveTo([]);

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isAdmin']);
    // isSuperadmin is read as a function in the component/computed.
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => superadmin;
    (session as unknown as { isAdmin: () => boolean }).isAdmin = () => !superadmin;

    TestBed.configureTestingModule({
      imports: [WorkloadConsoleComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(WorkloadConsoleComponent);
    component = fixture.componentInstance;
  }

  /** Run the async init chain to completion, then render. */
  async function init() {
    await component.ngOnInit();
    fixture.detectChanges();
  }

  it('loads the capability + pods on init and renders the pod table', async () => {
    configure(false);
    await init();

    expect(bff.workloadCapability).toHaveBeenCalled();
    expect(bff.workloadPods).toHaveBeenCalledWith('hugmesh-backend');
    expect(component.pods().length).toBe(2);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-pod="web-abc"]')).not.toBeNull();
  });

  it('hides the runtime-mutation buttons for a read-only admin', async () => {
    configure(false);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    // admin sees inspect but NOT restart/delete
    expect(el.textContent).toContain('inspect');
    expect(el.textContent).not.toContain('delete pod');
  });

  it('shows the runtime-mutation buttons + control plane for a superadmin', async () => {
    configure(true);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('delete pod');
    expect(el.textContent).toContain('Master config');
    expect(bff.workloadGrants).toHaveBeenCalled();
  });

  it('inspect() loads the projected DTO into the drawer', async () => {
    configure(true);
    bff.workloadInspect.and.resolveTo({
      namespace: 'hugmesh-backend', name: 'web-abc', workload: 'web', phase: 'Running',
      node: 'pi-1', serviceAccount: 'default', startedAt: null, containers: [],
      labels: {}, ownerKind: 'ReplicaSet', ownerName: 'web-66',
    });
    await init();
    await component.inspect(pod('web-abc'));
    expect(bff.workloadInspect).toHaveBeenCalledWith('hugmesh-backend', 'web-abc');
    expect(component.selected()?.name).toBe('web-abc');
  });

  it('issueGrant() validates and calls the BFF with the log-access opt-in', async () => {
    configure(true);
    bff.workloadGrant.and.resolveTo({
      id: 'g1', grantee: 'alice', targetDomain: 'brandx', accessLevel: 'READ_ONLY',
      logAccess: true, state: 'active', grantedBy: 'root', grantedAt: null, expiresAt: null,
      revokedAt: null, revokedBy: null, domain: 'brandx', propagationState: 'pending', generation: 1,
    });
    await init();

    component.grantGrantee = 'alice';
    component.grantDomain = 'brandx';
    component.grantLogAccess = true;
    component.grantTtlHours = 24;
    await component.issueGrant();

    expect(bff.workloadGrant).toHaveBeenCalledWith({
      grantee: 'alice', targetDomain: 'brandx', logAccess: true, ttlHours: 24,
    });
  });

  it('issueGrant() shows an error when fields are blank and never calls the BFF', async () => {
    configure(true);
    await init();
    component.grantGrantee = '';
    component.grantDomain = '';
    await component.issueGrant();
    expect(component.grantError()).toBeTruthy();
    expect(bff.workloadGrant).not.toHaveBeenCalled();
  });

  // ── runtime mutations forward the minted step-up token ──
  // The console mints a token via stepUp() and holds it in stepUpToken(); rolloutRestart and
  // deletePod used to drop it on the floor. They now hand it to the BffService call, which puts
  // it in X-Workload-StepUp. For ordinary names the BFF does not require it (RUNTIME_MUTATE), so
  // an unminted console must still be able to restart/delete; the UI does not gate on it. For a
  // name beginning with exec / lifecycle / port-forward the BFF misclassifies the call as
  // DANGEROUS and DOES validate the token (see the note in bff.service.ts), which is why it must
  // be forwarded rather than dropped.
  describe('runtime mutations + the minted step-up token', () => {
    beforeEach(() => {
      configure(true);
      spyOn(window, 'confirm').and.returnValue(true);
      bff.workloadStepUp.and.resolveTo({ stepUpToken: 'WK-minted', ttlMinutes: 5 });
      bff.workloadRolloutRestart.and.resolveTo({ deletedPods: 2, workload: 'web' });
      bff.workloadDeletePod.and.resolveTo({ deleted: 1, pod: 'web-abc' });
    });

    it('rolloutRestart() passes the minted token through to the BFF call', async () => {
      await init();
      await component.stepUp();
      expect(component.stepUpToken()).toBe('WK-minted');

      await component.rolloutRestart(pod('web-abc'));
      expect(bff.workloadRolloutRestart).toHaveBeenCalledOnceWith('hugmesh-backend', 'web', 'WK-minted');
      expect(component.actionMsg()).toBe('Requested rollout-restart of web.');
    });

    it('deletePod() passes the minted token through to the BFF call', async () => {
      await init();
      await component.stepUp();

      await component.deletePod(pod('web-abc'));
      expect(bff.workloadDeletePod).toHaveBeenCalledOnceWith('hugmesh-backend', 'web-abc', 'WK-minted');
      expect(component.actionMsg()).toBe('Deleted pod web-abc.');
    });

    it('with no token minted, both still call the BFF (token undefined → no header) — not gated client-side', async () => {
      await init();
      expect(component.stepUpToken()).toBeNull();

      await component.rolloutRestart(pod('web-abc'));
      await component.deletePod(pod('web-abc'));
      expect(bff.workloadRolloutRestart).toHaveBeenCalledOnceWith('hugmesh-backend', 'web', undefined);
      expect(bff.workloadDeletePod).toHaveBeenCalledOnceWith('hugmesh-backend', 'web-abc', undefined);
      expect(bff.workloadStepUp).not.toHaveBeenCalled();
    });
  });
});
