# MFA SECURITY console (/admin/security → MfaSecurityComponent, mfa-security-view)
# + the shared inline step-up dialog (MfaStepUpDialogComponent, mfa-stepup-dialog)
# that device-licenses, cloud-backups restore and the workload console all reuse.
# This surface had ZERO e2e despite being the step-up primitive every privileged
# console leans on. Covered here:
#   - cross-user FACTOR ISOLATION: the admin-bff derives the owner from the session
#     subject, never a body field, so one admin's real factor is invisible to another
#     (victim-creates-first — no TOTP needed, enroll alone creates the pending factor).
#   - the DARK default-stack reality (app.casdoor.mfa.enabled=false → the console
#     honestly says "not enabled yet").
#   - the step-up-gated remove + regenerate JOURNEY through the shared dialog, with a
#     REAL RFC-6238 code — the enabled-feature path.
#
# @cluster — needs a live Casdoor + admin-bff; ships dark.
@cluster @admin-ui @mfa
Feature: MFA security console — cross-user factor isolation and the step-up-gated journey

  # Owner scope: a factor enrolled in admin-domain-a's context is theirs alone. The
  # BFF never takes an owner from the request body, so admin-domain-b — reading their
  # OWN list in their OWN context — cannot see (or address) it. Enroll (no verify) is
  # enough to create the real pending factor the isolation is proven against.
  Scenario: one admin's enrolled factor is invisible to another admin (owner-scope isolation)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" starts TOTP enrollment via the BFF
    Then "admin-domain-a"'s factor list contains their enrolled factor
    And "admin-domain-b"'s factor list does not contain "admin-domain-a"'s enrolled factor

  # Default deployments ship MFA dark (503); the console degrades to an honest
  # "not enabled yet" instead of an error. Any admin reaches /admin/security (it is
  # a per-user surface, not superadmin-gated).
  Scenario: the MFA console degrades honestly when the feature ships dark
    Given "admin-domain-a" is logged in in their own context
    When "admin-domain-a" navigates to "/admin/security"
    Then "admin-domain-a" sees the "mfa-security-view" console
    And "admin-domain-a" sees the MFA console dark state

  # The enabled-feature path (needs app.casdoor.mfa.enabled=true). The remove and the
  # regenerate are BOTH step-up gated: the first attempt 403s, the shared dialog
  # appears mid-action, and only satisfying it with a real authenticator code completes
  # the mutation — the exact interruption every privileged console reuses.
  Scenario: removing a factor and regenerating recovery codes each require the step-up dialog
    Given "admin-domain-a" is logged in in their own context
    When "admin-domain-a" enrolls and verifies a TOTP factor via the BFF
    And "admin-domain-a" navigates to "/admin/security"
    Then "admin-domain-a" sees the "mfa-security-view" console
    And "admin-domain-a" sees their enrolled TOTP factor in the list
    When "admin-domain-a" removes their TOTP factor
    Then "admin-domain-a" sees the MFA step-up dialog
    When "admin-domain-a" satisfies the step-up with their authenticator code
    Then "admin-domain-a" no longer sees their TOTP factor in the list
    When "admin-domain-a" regenerates their recovery codes
    Then "admin-domain-a" sees the MFA step-up dialog
    When "admin-domain-a" satisfies the step-up with their authenticator code
    Then "admin-domain-a" sees a fresh set of one-time recovery codes
