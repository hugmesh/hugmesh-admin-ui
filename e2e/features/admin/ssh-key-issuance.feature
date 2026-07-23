# SSH KEY-ISSUANCE lifecycle on the Device Licenses console (device-licenses.component.ts
# runSshGated/issue/download/revoke) — a SUPERADMIN credential mint with a ONE-TIME
# private-key download, step-up gated, that had no e2e at all (bff-auth-gates only
# covered an anonymous device-licenses read). Every mutating verb is
# @PreAuthorize("hasRole('SUPERADMIN')") AND 403s "requires step-up" without a fresh
# step-up (verified against AdminSshKeyIssuanceController); the panel reuses the SAME
# shared MfaStepUpDialogComponent as the MFA console.
#
# @cluster — needs the host shell + admin-bff; ships dark. The mint-lifecycle scenario
# additionally needs app.ssh-issue.enabled=true AND app.casdoor.mfa.enabled=true (so
# the shared step-up dialog is live) — noted on that scenario.
@cluster @admin-ui @ssh-issuance
Feature: SSH key-issuance — ships-dark reality, superadmin-only gate, and the mint/one-time-download journey

  # Default deployments ship SSH issuance dark (app.ssh-issue.enabled=false); the
  # issued-keys read reports enabled:false and the console disables issuing/downloading/
  # revoking with an honest not-enabled note.
  Scenario: the issuance panel degrades honestly when the feature ships dark
    Given "superadmin" is logged in in their own context
    When "superadmin" navigates to "/admin/device-licenses"
    Then "superadmin" sees the "device-licenses-view" console
    When "superadmin" opens the SSH keys panel for the first registered device
    Then "superadmin" sees SSH key issuance is not enabled for that device

  # The mint is SUPERADMIN-only: a domain admin's issue POST dies at the role gate
  # before any body/feature logic, so the bean-valid path (deviceId present) can only
  # yield the authz verdict — 403, never a 400 or a dark 503.
  Scenario: a domain admin's issue POST is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in in their own context
    When "admin-domain-a" POSTs to "/bff/admin/ssh-issue/issue?deviceId=e2e-deny-probe" with body:
      """
      {}
      """
    Then the response status is 403

  # The enabled-feature journey: issuing 403s "needs step-up", the shared step-up
  # dialog appears, satisfying it mints the credential, and the private key downloads
  # exactly once (the second attempt is disabled — the one-time guarantee). Download is
  # ITSELF step-up gated, so the dialog appears again for it.
  Scenario: a superadmin mints an SSH credential through the step-up dialog and downloads it once
    Given "superadmin" is logged in in their own context
    When "superadmin" enrolls and verifies a TOTP factor via the BFF
    And "superadmin" navigates to "/admin/device-licenses"
    Then "superadmin" sees the "device-licenses-view" console
    When "superadmin" opens the SSH keys panel for the first registered device
    And "superadmin" issues a new SSH credential for that device
    Then "superadmin" sees the MFA step-up dialog
    When "superadmin" satisfies the step-up with their authenticator code
    Then "superadmin" sees a newly issued SSH key for that device
    When "superadmin" downloads that SSH key private key
    Then "superadmin" sees the MFA step-up dialog
    When "superadmin" satisfies the step-up with their authenticator code
    Then "superadmin" can no longer download that SSH key private key
