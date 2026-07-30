/**
 * Detects the platform's "step-up required" 403 contract so a privileged console can offer the
 * inline {@link MfaStepUpDialogComponent} instead of surfacing a bare error.
 *
 * <h2>What changed, and why</h2>
 * This module used to detect step-up by ONE means: a case-insensitive substring match on the
 * server's free-text error message (`/requires step-up/i`). Its own doc said "the free-text
 * phrase IS the contract" — which meant ANY backend reword of ANY gate message silently disabled
 * the step-up prompt fleet-wide and the retry flow died with a bare error.
 *
 * admin-bff now emits a STRUCTURED signal on step-up rejections (see its
 * `web/StepUpRequiredException` + `web/ApiExceptionHandler`):
 *
 *     HTTP/1.1 403 Forbidden
 *     X-Step-Up-Required: X-ImageGen-StepUp        <-- the retry header, i.e. the flavour
 *     {"error":"image build requires step-up re-authentication (present X-ImageGen-StepUp)"}
 *
 * Status is still 403 (never 428) and the JSON body is byte-identical to before, so this is a
 * purely additive wire change.
 *
 * <h2>Rolling deploy — compatible in BOTH directions</h2>
 * - **new UI + OLD BFF**: no signal header arrives, so {@link LEGACY_STEP_UP_PATTERN} is still
 *   consulted as a FALLBACK. Nothing regresses while the BFF rollout is in flight.
 * - **OLD UI + new BFF**: the backend deliberately RETAINS the literal phrase "requires step-up"
 *   in every gate message (pinned server-side by hard-coded assertions), so an old bundle still
 *   detects step-up by substring.
 *
 * <h2>Why a blind retry is correct</h2>
 * Once any gate is satisfied by a FRESH Casdoor-MFA stamp (the A5 UNIFIED step-up:
 * `mfaFresh || isSatisfied(subject, stepUpToken)`), a plain retry of the SAME privileged call
 * succeeds with no token needed — the BFF reads freshness off the caller's own session, not a
 * client-supplied value. So "show the dialog, then retry the original action" stays a correct,
 * general pattern; {@link stepUpRetryHeaderOf} exists for the callers that mint an explicit
 * step-up TOKEN instead and must know which header to put it on.
 *
 * <h2>NOT covered here: the `/bff/mfa/**` self-service plane</h2>
 * `MfaSecurityComponent` deliberately does NOT use this helper — see the comment at its
 * `r.status === 403` branches. Its 403s come from `MfaEnrollmentController`, which lives in the
 * hugmesh-auth-core JAR (a different repository) and whose message is
 * "requires a fresh MFA step-up to mutate factors" — a string {@link LEGACY_STEP_UP_PATTERN} has
 * never matched.
 */

/** The response header admin-bff stamps on (and only on) a step-up rejection. */
export const STEP_UP_SIGNAL_HEADER = 'X-Step-Up-Required';

/**
 * The pre-signal contract, kept ONLY as a fallback for an old BFF that has not rolled out yet.
 * Intentionally narrow so it cannot false-positive on unrelated 403s (an own-domain DENY, a
 * missing device license — none contain this phrase).
 */
export const LEGACY_STEP_UP_PATTERN = /requires step-up/i;

/**
 * The shape a signal value must have to be trusted: one of the gates' `X-<flavour>-StepUp`
 * constants. BYTE-IDENTICAL to the server-side `SAFE_HEADER_NAME` in
 * `admin-bff/src/main/java/systems/hugmesh/adminbff/web/StepUpRequiredException.java`.
 *
 * This is not paranoia for its own sake: the value is handed back to `fetch` as a REQUEST header
 * NAME, so an unvalidated value from a rogue proxy or a misconfigured intermediary would be a
 * header-injection vector. Anything that is not a gate constant is ignored, and detection then
 * falls through to the legacy phrase.
 */
const SAFE_RETRY_HEADER = /^X-[A-Za-z0-9-]{1,60}-StepUp$/;

/** How a step-up requirement was recognised — structured signal, or the legacy phrase. */
export type StepUpDetection = 'signal' | 'legacy-phrase';

/** A recognised step-up requirement. */
export interface StepUpRequirement {
  /**
   * The REQUEST header name a step-up token must ride on when retrying, e.g.
   * `X-ImageGen-StepUp`. `null` when only the legacy phrase was available (an old BFF), in which
   * case the caller falls back to a plain retry after the MFA dialog — which is what every
   * current caller does anyway.
   */
  readonly retryHeader: string | null;
  /** Which of the two detection paths fired. Useful for diagnostics during a rolling deploy. */
  readonly via: StepUpDetection;
}

/**
 * The error {@link BffService} throws for a non-2xx, carrying the bits of the response the
 * step-up contract needs. Extends `Error` and keeps `message` as the BFF's `{error}` text, so
 * every existing `e instanceof Error ? e.message : …` caller is unaffected.
 */
export class BffHttpError extends Error {
  constructor(
    message: string,
    /** The HTTP status. `0` when the status was not observable. */
    readonly status: number,
    /** The raw {@link STEP_UP_SIGNAL_HEADER} value, if the response carried one. */
    readonly stepUpSignal: string | null,
  ) {
    super(message);
    this.name = 'BffHttpError';
  }
}

/** The `message` of anything throwable, in the shape this module has always accepted. */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === 'string' ? e : '';
}

/**
 * The single detection seam: prefers the STRUCTURED signal, falls back to the legacy substring.
 * Returns `null` when `e` is not a step-up rejection at all — notably for an ordinary 403, since
 * a routine authz DENY must never pop an MFA prompt.
 */
export function stepUpRequirementOf(e: unknown): StepUpRequirement | null {
  // 1. STRUCTURED — trusted only on a 403, the only status the BFF ever pairs the signal with;
  //    that stops a stray header on some other response from popping a dialog.
  if (e instanceof BffHttpError && e.status === 403 && e.stepUpSignal
      && SAFE_RETRY_HEADER.test(e.stepUpSignal)) {
    return { retryHeader: e.stepUpSignal, via: 'signal' };
  }
  // 2. FALLBACK — an old BFF with no signal header. Deliberately status-agnostic, exactly as the
  //    pre-signal implementation was, so a mid-rollout client behaves identically.
  if (LEGACY_STEP_UP_PATTERN.test(messageOf(e))) {
    return { retryHeader: null, via: 'legacy-phrase' };
  }
  return null;
}

/** True when `e` is the step-up-required 403. Signature unchanged for its 11 existing callers. */
export function isStepUpRequiredError(e: unknown): boolean {
  return stepUpRequirementOf(e) !== null;
}

/**
 * The request-header name a step-up token must ride on when retrying `e`'s action, or `null` if
 * `e` is not a step-up error / the flavour was not advertised (old BFF).
 *
 * <h3>Who uses this, and who does not</h3>
 * Only the callers that carry an explicit step-up TOKEN need it. The production caller is the
 * managed backing-services console: `BackingServiceApiError.stepUpRetryHeader` →
 * `BackingServicesService.setMode(..., retryHeader)`, so the operator's pasted token is sent on the
 * header the SERVER named and the console's own prompt shows that name. That is the design paying
 * off end-to-end — no client-side flavour table, so a gate that changes its header needs no UI
 * release.
 *
 * The other consumers deliberately do NOT use it: they retry BLINDLY after
 * `MfaStepUpDialogComponent` reports `satisfied`, because that dialog satisfies step-up on the
 * caller's own session (`mfaFresh`) and emits no token — see its class doc, "No stepUpToken
 * plumbing is needed on the retry". For them {@link isStepUpRequiredError} is the whole contract.
 */
export function stepUpRetryHeaderOf(e: unknown): string | null {
  return stepUpRequirementOf(e)?.retryHeader ?? null;
}
