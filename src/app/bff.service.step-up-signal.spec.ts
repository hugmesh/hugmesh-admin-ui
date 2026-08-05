import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BffService } from './bff.service';
import { SessionService, HugSession } from './session.service';
import {
  BffHttpError,
  STEP_UP_SIGNAL_HEADER,
  isStepUpRequiredError,
  stepUpRequirementOf,
  stepUpRetryHeaderOf,
} from './mfa/step-up-error';

/**
 * The TRANSPORT half: proves {@link BffService} actually lifts the `X-Step-Up-Required` response
 * header off a real `Response` and onto the thrown error, for real step-up-gated endpoints.
 *
 * This is the seam the old contract could not reach at all: `throw new Error(await errorOf(r))`
 * discarded the whole `Response`, which is exactly WHY the pre-existing contract had to be a
 * substring match on the message.
 *
 * Uses a REAL `Headers` instance (unlike the older `jsonResponse` stub in `bff.service.spec.ts`,
 * which omits `headers` entirely — a case this suite also covers, since losing the header must
 * degrade to the legacy phrase rather than throw).
 *
 * One DECLARED behaviour change rides along, pinned below: nine sites that inlined
 * ``(await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}` `` now go through `errorOf()`,
 * which consults `body.note` in between — so a dark `{dark:true, note}` body surfaces the note
 * where it used to surface "HTTP 503". Every other site's message is byte-identical.
 */
function response(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
    blob: async () => new Blob([]),
  } as unknown as Response;
}

/** A response with NO `headers` property at all — the older spec-stub shape. */
function headerlessResponse(body: unknown, status: number): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
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

describe('BffService step-up signal transport', () => {
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

  /** Run `call`, expect it to reject, and hand back the rejection. */
  async function rejection(call: Promise<unknown>): Promise<unknown> {
    try {
      await call;
    } catch (e) {
      return e;
    }
    throw new Error('expected the call to reject');
  }

  // ── the structured signal arrives, per gate ───────────────────────────────────

  it('lifts the signal off an image-gen trigger 403 and names X-ImageGen-StepUp', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'image build requires step-up re-authentication (present X-ImageGen-StepUp)' },
      { ok: false, status: 403, headers: { [STEP_UP_SIGNAL_HEADER]: 'X-ImageGen-StepUp' } }));

    const e = await rejection(service.triggerImageBuild({} as never));

    expect(e instanceof BffHttpError).toBe(true);
    expect((e as BffHttpError).status).toBe(403);
    expect(stepUpRequirementOf(e)).toEqual({ retryHeader: 'X-ImageGen-StepUp', via: 'signal' });
  });

  it('lifts the signal off an ssh-key issue 403 and names X-SshKeyIssue-StepUp', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'issue requires step-up re-authentication (present X-SshKeyIssue-StepUp)' },
      { ok: false, status: 403, headers: { [STEP_UP_SIGNAL_HEADER]: 'X-SshKeyIssue-StepUp' } }));

    expect(stepUpRetryHeaderOf(await rejection(service.issueSshKey('dev-1'))))
      .toBe('X-SshKeyIssue-StepUp');
  });

  it('lifts the signal off a phone-lock 403 and names X-PhoneLock-StepUp', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'lock requires step-up re-authentication (present X-PhoneLock-StepUp)' },
      { ok: false, status: 403, headers: { [STEP_UP_SIGNAL_HEADER]: 'X-PhoneLock-StepUp' } }));

    expect(stepUpRetryHeaderOf(await rejection(service.lockPhone('phone-1', 'stolen'))))
      .toBe('X-PhoneLock-StepUp');
  });

  it('lifts the signal off a desktop remote-install 403 and names X-Device-Terminal-StepUp', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'remote-install requires step-up re-authentication (present X-Device-Terminal-StepUp)' },
      { ok: false, status: 403,
        headers: { [STEP_UP_SIGNAL_HEADER]: 'X-Device-Terminal-StepUp' } }));

    expect(stepUpRetryHeaderOf(await rejection(service.desktopRemoteInstall('dev-1', 'app'))))
      .toBe('X-Device-Terminal-StepUp');
  });

  it('lifts the signal off the image-gen keys DOWNLOAD (a blob endpoint, not JSON)', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'keys download requires step-up re-authentication (present X-ImageGen-StepUp)' },
      { ok: false, status: 403, headers: { [STEP_UP_SIGNAL_HEADER]: 'X-ImageGen-StepUp' } }));

    expect(stepUpRetryHeaderOf(await rejection(service.downloadImageKeys('b-1'))))
      .toBe('X-ImageGen-StepUp');
  });

  // ── the CLOSED retry-header vocabulary — the UI half of the cross-repo pin ────
  //
  // This list is the MIRROR of the BFF pin in hugmesh-admin-bff-api
  // `src/test/java/systems/hugmesh/adminbff/web/StepUpSignalContractTest.java`
  // (its `VOCABULARY` array + `theEightFlavours_areAllDistinct`, hasSize(8), and the
  // hard-coded per-gate literal assertions). The two lists MUST change in LOCKSTEP,
  // in the same cross-repo change: the BFF side reds when a gate adds a 9th flavour
  // or renames one, and THIS pin is what reds the UI side — without it a vocabulary
  // change sails through here silently (the SAFE_RETRY_HEADER shape-regex in
  // mfa/step-up-error.ts accepts ANY X-<flavour>-StepUp, by design). The loop-only
  // FLAVOURS list in mfa/step-up-error.spec.ts is the detection-unit sibling of this
  // transport-level list; keep all three in step.

  /** The 8 retry-header names, byte-identical to the BFF gate constants. */
  const RETRY_HEADER_VOCABULARY = [
    'X-BackingServices-StepUp',
    'X-Backup-StepUp',
    'X-Device-Terminal-StepUp',
    'X-GoLive-StepUp',
    'X-ImageGen-StepUp',
    'X-PhoneLock-StepUp',
    'X-ServiceStore-StepUp',
    'X-SshKeyIssue-StepUp',
  ];

  it('pins the closed vocabulary: exactly 8 names, byte-identical to the BFF pin, no drift', () => {
    // Spelled out AGAIN as literals inside the assertion ON PURPOSE (the BFF pin
    // does the same): a drifted edit of RETRY_HEADER_VOCABULARY above — one name
    // removed, a 9th added, or a byte changed — must fail HERE rather than merely
    // shrink/grow the loops that consume the list.
    // The failure message itself names the mirror, so the author who trips this
    // lands on the cross-repo contract without hunting for the comment above.
    const MIRROR = 'this list is the byte-identical mirror of the BFF pin in '
      + 'hugmesh-admin-bff-api src/test/java/systems/hugmesh/adminbff/web/'
      + 'StepUpSignalContractTest.java — change BOTH in the same cross-repo act, '
      + 'plus the FLAVOURS list in src/app/mfa/step-up-error.spec.ts';
    expect(RETRY_HEADER_VOCABULARY).withContext(MIRROR).toEqual([
      'X-BackingServices-StepUp',
      'X-Backup-StepUp',
      'X-Device-Terminal-StepUp',
      'X-GoLive-StepUp',
      'X-ImageGen-StepUp',
      'X-PhoneLock-StepUp',
      'X-ServiceStore-StepUp',
      'X-SshKeyIssue-StepUp',
    ]);
    expect(RETRY_HEADER_VOCABULARY.length).withContext(MIRROR).toBe(8);
    expect(new Set(RETRY_HEADER_VOCABULARY).size).withContext(MIRROR).toBe(8);
  });

  it('handles EVERY vocabulary name through the real transport seam: header -> error -> detection -> retry plumbing', async () => {
    for (const flavour of RETRY_HEADER_VOCABULARY) {
      // The body is deliberately phrase-free: the header ALONE must carry the
      // requirement for every flavour, or a gate rewording its message would
      // silently kill that flavour's dialog.
      fetchSpy.and.resolveTo(response(
        { error: 'a second factor is needed before this can run' },
        { ok: false, status: 403, headers: { [STEP_UP_SIGNAL_HEADER]: flavour } }));

      const e = await rejection(service.triggerImageBuild({} as never));

      expect(isStepUpRequiredError(e)).withContext(flavour).toBe(true);
      // The dialog plumbing consumes the retry-header NAME (the backing-services
      // console sends the operator's token on exactly this header; the other
      // consumers key off isStepUpRequiredError to open MfaStepUpDialogComponent).
      expect(stepUpRetryHeaderOf(e)).withContext(flavour).toBe(flavour);
      expect(stepUpRequirementOf(e)).withContext(flavour)
        .toEqual({ retryHeader: flavour, via: 'signal' });
    }
  });

  // ── the message is still verbatim, so nothing that reads e.message changes ────

  it('keeps the BFF {error} text as the Error message, verbatim', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'image build requires step-up re-authentication (present X-ImageGen-StepUp)' },
      { ok: false, status: 403, headers: { [STEP_UP_SIGNAL_HEADER]: 'X-ImageGen-StepUp' } }));

    const e = await rejection(service.triggerImageBuild({} as never));

    expect((e as Error).message)
      .toBe('image build requires step-up re-authentication (present X-ImageGen-StepUp)');
  });

  it('keeps errorOf()\'s {note} then HTTP <status> fallback where it already applied', async () => {
    // issueSshKey already routed through errorOf() before this change; only the thrown TYPE moved.
    fetchSpy.and.resolveTo(response({ dark: true, note: 'ssh issuance ships dark' },
      { ok: false, status: 503 }));
    expect(((await rejection(service.issueSshKey('dev-1'))) as Error).message)
      .toBe('ssh issuance ships dark');

    fetchSpy.and.resolveTo(response({}, { ok: false, status: 502 }));
    expect(((await rejection(service.issueSshKey('dev-1'))) as Error).message).toBe('HTTP 502');
  });

  // ── DECLARED behaviour change: the 9 formerly-bare sites gained the {note} fallback ───

  it('surfaces {note} at a site that previously fell straight through to HTTP <status>', async () => {
    // NOT a no-op refactor, and worth stating plainly. Nine sites used to inline
    //     (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`
    // and now route through errorOf(), which consults `body.note` between those two. So a dark
    // `{dark:true, note}` body — a REAL admin-bff shape (AdminSshKeyIssuanceController.darkResponse
    // and friends) — now reaches the operator instead of the useless "HTTP 503".
    //
    // The nine: runTestReport, triggerImageBuild, submitWorklistBatch, forumSend, licenseMutation,
    // registerFromPending, postJob, workloadLifecycle, workloadMutate. This is a deliberate
    // improvement, kept rather than scoped away: `body.note` is only consulted when `body.error` is
    // ABSENT, so no site's normal message changes, and two of the nine (triggerImageBuild,
    // submitWorklistBatch) are step-up gated — giving them a different extractor from the rest
    // would re-introduce the duplication this change removed.
    fetchSpy.and.resolveTo(response({ dark: true, note: 'image-gen launch ships dark' },
      { ok: false, status: 503 }));

    expect(((await rejection(service.triggerImageBuild({} as never))) as Error).message)
      .toBe('image-gen launch ships dark');   // was: 'HTTP 503'

    fetchSpy.and.resolveTo(response({ dark: true, note: 'workload console ships dark' },
      { ok: false, status: 503 }));
    expect(((await rejection(
      service.workloadLifecycle('ns', 'wl', 'restart', {} as never))) as Error).message)
      .toBe('workload console ships dark');   // was: 'HTTP 503'
  });

  it('leaves the HTTP <status> fallback intact at those sites when there is no note either', async () => {
    // The only path that changed is "no {error} BUT a {note}". A body with neither still yields
    // exactly the string those nine sites produced before.
    fetchSpy.and.resolveTo(response({}, { ok: false, status: 502 }));
    expect(((await rejection(service.triggerImageBuild({} as never))) as Error).message)
      .toBe('HTTP 502');

    fetchSpy.and.resolveTo(response({ error: 'quota exceeded' }, { ok: false, status: 429 }));
    expect(((await rejection(service.triggerImageBuild({} as never))) as Error).message)
      .toBe('quota exceeded');
  });

  // ── OLD BFF: no signal header -> the legacy substring still carries it ────────

  it('an OLD BFF 403 (no signal header) is STILL detected, via the legacy phrase', async () => {
    fetchSpy.and.resolveTo(response(
      { error: 'image build requires step-up re-authentication (present X-ImageGen-StepUp)' },
      { ok: false, status: 403 }));

    const e = await rejection(service.triggerImageBuild({} as never));

    expect(isStepUpRequiredError(e)).toBe(true);
    expect(stepUpRequirementOf(e)).toEqual({ retryHeader: null, via: 'legacy-phrase' });
  });

  it('a response object with NO headers property degrades to the phrase, never throws', async () => {
    // The older jsonResponse() stub shape, and any fetch polyfill/interceptor that drops
    // headers. Must not turn the server's real error into a TypeError.
    fetchSpy.and.resolveTo(headerlessResponse(
      { error: 'lock requires step-up re-authentication (present X-PhoneLock-StepUp)' }, 403));

    const e = await rejection(service.lockPhone('phone-1', 'stolen'));

    expect((e as Error).message)
      .toBe('lock requires step-up re-authentication (present X-PhoneLock-StepUp)');
    expect(stepUpRequirementOf(e)).toEqual({ retryHeader: null, via: 'legacy-phrase' });
  });

  // ── THE NEGATIVE: an ordinary rejection must never look like step-up ──────────

  it('an ordinary 403 (no signal, no phrase) is NOT step-up', async () => {
    fetchSpy.and.resolveTo(response({ error: 'no active SSH license for this device' },
      { ok: false, status: 403 }));

    const e = await rejection(service.issueSshKey('dev-1'));

    expect(isStepUpRequiredError(e)).toBe(false);
    expect(stepUpRetryHeaderOf(e)).toBeNull();
    expect((e as Error).message).toBe('no active SSH license for this device');
  });

  it('a 409 BYOD conflict is NOT step-up', async () => {
    fetchSpy.and.resolveTo(response({ error: "phone 'byod' is not a managed device" },
      { ok: false, status: 409 }));

    expect(isStepUpRequiredError(await rejection(service.lockPhone('byod', 'x')))).toBe(false);
  });

  it('a 404 does not leak into the step-up path', async () => {
    fetchSpy.and.resolveTo(response({ error: "phone 'other' not found" },
      { ok: false, status: 404 }));

    expect(isStepUpRequiredError(await rejection(service.lockOwnedPhone('other', 'x')))).toBe(false);
  });
});
