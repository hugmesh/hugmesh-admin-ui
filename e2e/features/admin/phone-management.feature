# Superadmin Phone-fleet device-management + lockout coverage (phone-management.feature).
# Extends the phone-fleet console (phone-fleet.feature, read-only) with the WRITE seam this
# wave adds: a superadmin sets the AUTHORITATIVE management mode (managed / BYOD) and, for a
# managed device, locks/unlocks it — all SUPERADMIN-only + step-up gated at the BFF.
#
# Honesty rules (same as phone-fleet.feature):
#   - PATHS ARE HOST-ABSOLUTE (/admin/phone-fleet): the harness drives the HOST front door; an
#     un-prefixed path falls into the host wildcard redirect and never touches superadminGuard.
#   - The manage/lock UI steps drive the REAL console controls (mark-managed / lock buttons) and
#     hold the DOM to the authoritative chips the BFF returns — never a bare "element exists".
#   - The BYOD-disabled step asserts the control the component actually disabled (a BYOD device
#     is not lockable) plus its helper note — the requirement's disabled+helptext pairing.
#   - The DENYs are REAL: a seeded ROLE_ADMIN is bounced from the console (superadminGuard), and
#     a genuine ROLE_ADMIN's lock POST is rejected outright — 403 only, the authz verdict.
#
# @cluster — ships dark; the default config filters `not @cluster` so no live stack is needed
# (a no-filter bddgen + `playwright test --list` still proves every scenario + step parses).
@cluster @admin-ui @phone-fleet @phone-management
Feature: Phone device management + lockout — superadmin managed/BYOD + lock controls

  Scenario: a superadmin marks a phone managed then locks it
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    When "superadmin" marks the first phone managed
    Then "superadmin" sees the first phone reported as managed
    When "superadmin" locks the first phone with reason "e2e lockout drill"
    Then "superadmin" sees the first phone reported as locked

  Scenario: a BYOD phone's lock control is disabled (not lockable)
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    And "superadmin" sees the lock control disabled for an unmanaged phone

  Scenario: a domain admin is bounced from the Phone fleet console (DENY)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/admin/phone-fleet"
    Then "admin-domain-a" is redirected to the login page

  # A domain admin genuinely holds ROLE_ADMIN — not a no-role probe — yet the lock mutation is
  # hasRole('SUPERADMIN') only, so the write is rejected outright: 403, never a validation 400.
  Scenario: a domain admin's phone lock mutation is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" POSTs to "/bff/superadmin/phone-devices/phone-e2e/lock" with body:
      """
      {"reason":"e2e denied lock"}
      """
    Then the response status is 403
