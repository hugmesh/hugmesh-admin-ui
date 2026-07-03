/**
 * Detects the platform's "requires step-up" 403 contract so a privileged
 * console can offer the inline {@link MfaStepUpDialogComponent} instead of just
 * surfacing a bare error. EVERY step-up-gated admin-bff controller (image-gen's
 * `ImageGenStepUpGate`, cloud-backup's `BackupStepUpGate`, the desktop-terminal
 * `DeviceTerminalStepUpGate`, the ssh-key-issuance `SshKeyIssueStepUpGate`, …)
 * throws the shared `ApiException.forbidden(...)` with a message containing the
 * phrase "requires step-up" — e.g. "image build requires step-up
 * re-authentication (present X-ImageGen-StepUp)" or "restore requires step-up:
 * present a valid step-up token in the X-Backup-StepUp header" — rendered as the
 * `{"error": "<message>"}` body every admin-bff 403 carries (`ApiExceptionHandler`).
 * There is no separate structured signal (no dedicated header/field) — the
 * free-text phrase IS the contract, so this sniff is intentionally narrow
 * (case-insensitive "requires step-up") to avoid false-positives on unrelated
 * 403s (e.g. an own-domain DENY, which never contains that phrase).
 *
 * Once ANY of those gates is satisfied by a FRESH Casdoor-MFA stamp (the A5
 * UNIFIED step-up: `mfaFresh || isSatisfied(subject, stepUpToken)`), a plain
 * retry of the SAME privileged call succeeds with no token needed — the BFF
 * reads the freshness off the caller's own session, not a client-supplied
 * value. That is what makes "show the dialog, then blindly retry the original
 * action" a correct, general pattern here.
 */
const STEP_UP_PATTERN = /requires step-up/i;

/** True when `e` (as thrown by {@link BffService} / any hand-written client that
 *  follows its `throw new Error(err)` convention) is the step-up-required 403. */
export function isStepUpRequiredError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return STEP_UP_PATTERN.test(message);
}
