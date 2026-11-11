import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BffService, TaskDef } from './bff.service';
import { SessionService, HugSession } from './session.service';

/** Minimal fetch Response stub (mirrors bff.service.spec.ts), with a content type. */
function response(body: unknown, init?: { status?: number; contentType?: string }): Response {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': init?.contentType ?? 'application/json' }),
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token < in JSON');
      return body;
    },
  } as unknown as Response;
}

function adminSession(): HugSession {
  return {
    id: 'google:admin@gmail.com',
    label: 'admin@gmail.com',
    provider: 'google',
    roles: ['admin'],
    registrationComplete: true,
  };
}

const task: TaskDef = {
  id: 'gateway-route', title: 'Add a gateway route', description: 'd',
  steps: [{ id: 'define', title: 'Define', fields: [] }],
};

/**
 * GUI-10: the guided-task catalogue load must keep "no backend on this deployment" (404),
 * "the load failed" and "the catalogue is empty" apart. Before the fix all three came back
 * as [] and the page said "No admin tasks available." for a backend that does not exist.
 */
describe('BffService.adminTasks', () => {
  let service: BffService;
  let fetchSpy: jasmine.Spy;
  const sessionSig = signal<HugSession | null>(null);

  beforeEach(() => {
    sessionSig.set(adminSession());
    TestBed.configureTestingModule({
      providers: [BffService, { provide: SessionService, useValue: { session: sessionSig } }],
    });
    service = TestBed.inject(BffService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  it('GETs /bff/admin/tasks with the session cookie', async () => {
    fetchSpy.and.resolveTo(response({ tasks: [] }));
    await service.adminTasks();
    expect(String(fetchSpy.calls.mostRecent().args[0])).toContain('/bff/admin/tasks');
    expect((fetchSpy.calls.mostRecent().args[1] as RequestInit).credentials).toBe('include');
  });

  it('maps a 404 (no admin-bff serves the surface) to unavailable', async () => {
    fetchSpy.and.resolveTo(response({ error: 'Not Found' }, { status: 404 }));
    expect(await service.adminTasks()).toEqual({ state: 'unavailable' });
  });

  it('maps a 2xx HTML answer (SPA fallback / misrouted gateway row) to unavailable', async () => {
    fetchSpy.and.resolveTo(response('<!doctype html><html></html>', { contentType: 'text/html' }));
    expect(await service.adminTasks()).toEqual({ state: 'unavailable' });
  });

  it('maps a JSON body without a tasks array to unavailable', async () => {
    fetchSpy.and.resolveTo(response({ items: [task] }));
    expect(await service.adminTasks()).toEqual({ state: 'unavailable' });
  });

  it('maps any other HTTP failure to an error carrying the status', async () => {
    fetchSpy.and.resolveTo(response({ error: 'boom' }, { status: 500 }));
    expect(await service.adminTasks()).toEqual({ state: 'error', status: 500 });
    fetchSpy.and.resolveTo(response({ error: 'forbidden' }, { status: 403 }));
    expect(await service.adminTasks()).toEqual({ state: 'error', status: 403 });
  });

  it('maps a network failure to an error with status 0', async () => {
    fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
    expect(await service.adminTasks()).toEqual({ state: 'error', status: 0 });
  });

  it('returns the catalogue, empty or not, as ok', async () => {
    fetchSpy.and.resolveTo(response({ tasks: [task] }));
    expect(await service.adminTasks()).toEqual({ state: 'ok', tasks: [task] });
    fetchSpy.and.resolveTo(response({ tasks: [] }));
    expect(await service.adminTasks()).toEqual({ state: 'ok', tasks: [] });
  });
});
