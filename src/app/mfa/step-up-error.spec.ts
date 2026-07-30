import {
  BffHttpError,
  LEGACY_STEP_UP_PATTERN,
  STEP_UP_SIGNAL_HEADER,
  isStepUpRequiredError,
  stepUpRequirementOf,
  stepUpRetryHeaderOf,
} from './step-up-error';

/**
 * THE client half of the structured step-up contract.
 *
 * Before it, the browser's ONLY way to know "this action needs step-up" was a case-insensitive
 * substring match on a server error STRING, so any backend reword silently disabled the inline
 * MFA dialog fleet-wide and the retry flow died with a bare error. These specs pin:
 *   1. the STRUCTURED path is detected and PREFERRED, and surfaces the FLAVOUR;
 *   2. the legacy SUBSTRING is still detected when no signal arrives (an OLD BFF, mid-rollout);
 *   3. a plain 403 with NEITHER is NOT step-up — the important negative, because a routine authz
 *      DENY must never pop an MFA prompt.
 */
describe('step-up detection', () => {
  /** The 8-value closed vocabulary the BFF's gate constants define. */
  const FLAVOURS = [
    'X-BackingServices-StepUp',
    'X-Backup-StepUp',
    'X-Device-Terminal-StepUp',
    'X-GoLive-StepUp',
    'X-ImageGen-StepUp',
    'X-PhoneLock-StepUp',
    'X-ServiceStore-StepUp',
    'X-SshKeyIssue-StepUp',
  ];

  /** A NEW BFF response: 403 + the signal header + the (still-present) legacy phrase. */
  const newBff = (flavour: string, message = `op requires step-up (present ${flavour})`) =>
    new BffHttpError(message, 403, flavour);

  /** An OLD BFF response: 403, NO signal header, only the free-text phrase. */
  const oldBff = (message: string) => new BffHttpError(message, 403, null);

  // ── 1. the structured path ────────────────────────────────────────────────────

  it('detects the structured signal and reports it as the detection path', () => {
    const req = stepUpRequirementOf(newBff('X-ImageGen-StepUp'));

    expect(req).toEqual({ retryHeader: 'X-ImageGen-StepUp', via: 'signal' });
    expect(isStepUpRequiredError(newBff('X-ImageGen-StepUp'))).toBe(true);
  });

  it('surfaces the flavour so a caller sets the RIGHT retry header', () => {
    for (const flavour of FLAVOURS) {
      expect(stepUpRetryHeaderOf(newBff(flavour))).toBe(flavour);
    }
  });

  it('PREFERS the signal over the message, even when the message says nothing about step-up', () => {
    // Proves the free-text phrase is no longer load-bearing when a signal is present: this is
    // the whole point — a backend reword can no longer disable the prompt.
    const reworded = new BffHttpError(
      'this operation needs a second factor before it can run', 403, 'X-GoLive-StepUp');

    expect(LEGACY_STEP_UP_PATTERN.test(reworded.message)).toBe(false);
    expect(stepUpRequirementOf(reworded)).toEqual({
      retryHeader: 'X-GoLive-StepUp', via: 'signal',
    });
  });

  // ── 2. the legacy fallback (new UI + OLD BFF) ─────────────────────────────────

  it('FALLS BACK to the substring when an OLD BFF sends no signal header', () => {
    const req = stepUpRequirementOf(
      oldBff('image build requires step-up re-authentication (present X-ImageGen-StepUp)'));

    expect(req).toEqual({ retryHeader: null, via: 'legacy-phrase' });
    expect(isStepUpRequiredError(
      oldBff('image build requires step-up re-authentication (present X-ImageGen-StepUp)')))
      .toBe(true);
  });

  it('falls back for cloud-backup restore, whose wording differs from the template', () => {
    expect(isStepUpRequiredError(
      oldBff('restore requires step-up: present a valid step-up token in the '
        + 'X-Backup-StepUp header'))).toBe(true);
  });

  it('falls back for a bare Error — the pre-signal thrown shape, and any other client', () => {
    // Every hand-written client that still does `throw new Error(bffErrorText)` keeps working.
    expect(isStepUpRequiredError(
      new Error('revoke requires step-up re-authentication (present X-SshKeyIssue-StepUp)')))
      .toBe(true);
    expect(isStepUpRequiredError('issue requires step-up re-authentication')).toBe(true);
  });

  it('is case-insensitive on the fallback, exactly as before', () => {
    expect(isStepUpRequiredError(oldBff('REQUIRES STEP-UP now'))).toBe(true);
  });

  it('does NOT claim a flavour it was never told — fallback retryHeader is null', () => {
    // The header name IS present in the legacy message text, but parsing it back out would
    // re-create the brittleness this change removes. Callers get null and retry plainly.
    expect(stepUpRetryHeaderOf(
      oldBff('image build requires step-up re-authentication (present X-ImageGen-StepUp)')))
      .toBeNull();
  });

  // ── 3. THE NEGATIVE: neither signal nor phrase => NOT step-up ─────────────────

  it('a plain 403 with NEITHER signal nor phrase is NOT step-up', () => {
    expect(stepUpRequirementOf(oldBff('no active SSH license for this device'))).toBeNull();
    expect(isStepUpRequiredError(oldBff('no active SSH license for this device'))).toBe(false);
    expect(stepUpRetryHeaderOf(oldBff('no active SSH license for this device'))).toBeNull();
  });

  it('an ordinary authz DENY on any status is NOT step-up', () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422, 500, 502, 503]) {
      expect(isStepUpRequiredError(new BffHttpError('forbidden', status, null)))
        .withContext(`status ${status}`).toBe(false);
    }
  });

  it('non-error values are NOT step-up', () => {
    for (const value of [undefined, null, 0, {}, [], true]) {
      expect(isStepUpRequiredError(value)).withContext(`${String(value)}`).toBe(false);
    }
  });

  // ── hardening: the signal is only honoured on a 403, and only in the closed shape ──

  it('ignores a signal header on a status the BFF never pairs it with', () => {
    // A stray/injected header on a 200/500 must not pop an MFA dialog.
    expect(isStepUpRequiredError(new BffHttpError('boom', 500, 'X-Backup-StepUp'))).toBe(false);
    expect(isStepUpRequiredError(new BffHttpError('gone', 410, 'X-Backup-StepUp'))).toBe(false);
  });

  it('ignores a signal value outside the X-<flavour>-StepUp shape', () => {
    // The value is handed to fetch as a REQUEST header name, so a malformed one must never be
    // trusted. Detection falls through to the phrase, which is absent here.
    for (const bogus of ['Authorization', 'X-Evil\r\nSet-Cookie: a=b', 'x-imagegen-stepup', '']) {
      expect(isStepUpRequiredError(new BffHttpError('denied', 403, bogus)))
        .withContext(bogus).toBe(false);
    }
  });

  it('a malformed signal still falls back to the phrase when the phrase IS present', () => {
    expect(stepUpRequirementOf(new BffHttpError(
      'issue requires step-up re-authentication', 403, 'Authorization')))
      .toEqual({ retryHeader: null, via: 'legacy-phrase' });
  });

  // ── the constants are the contract; keep them byte-identical to the BFF ───────

  it('pins the header name and the legacy phrase the two halves agree on', () => {
    expect(STEP_UP_SIGNAL_HEADER).toBe('X-Step-Up-Required');
    expect(LEGACY_STEP_UP_PATTERN.source).toBe('requires step-up');
    expect(LEGACY_STEP_UP_PATTERN.flags).toBe('i');
  });

  it('BffHttpError stays an Error whose message is the BFF text verbatim', () => {
    const e = newBff('X-Backup-StepUp', 'restore requires step-up: present a valid token');

    expect(e instanceof Error).toBe(true);
    expect(e.message).toBe('restore requires step-up: present a valid token');
    expect(e.status).toBe(403);
  });
});
