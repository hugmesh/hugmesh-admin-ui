# SUPERADMIN fleet provisioning coverage (fleet-provisioning.feature). The two SUPERADMIN-only
# surfaces this wave adds: (1) owner ASSIGNMENT on the existing phone-fleet console
# (/admin/phone-fleet → PUT /bff/superadmin/phone-devices/{id}/owner) — set the OPERATOR-
# AUTHORITATIVE physical_owner + owner_domain that ARE the tenancy wall for the public "My fleet"
# surface; and (2) the Fleet entitlements console (/admin/fleet-entitlements → grant/revoke the
# per-subject FLEET_ADMIN subscription). Both are SUPERADMIN-only + step-up gated at the BFF.
#
# Honesty rules (same as phone-management.feature):
#   - PATHS ARE HOST-ABSOLUTE (/admin/**): the harness drives the HOST front door; an un-prefixed
#     path falls into the host wildcard redirect and never touches superadminGuard.
#   - The provisioning UI steps drive the REAL console controls (owner inputs + Assign button, the
#     grant form + Revoke button) and hold the DOM to what the BFF returned — never a bare
#     "element exists".
#   - The menu split is a REAL superadminOnly assertion; the DENYs are REAL (a genuine ROLE_ADMIN
#     bounced by the guard, and a genuine ROLE_ADMIN's superadmin read rejected — 403 only).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @fleet-entitlement
Feature: Fleet provisioning — superadmin owner assignment + fleet entitlements

  Scenario: a superadmin assigns a phone's fleet owner on the phone-fleet console
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    When "superadmin" assigns the first phone to owner "casdoor:fleet-owner-a" in domain "domain-a"
    Then "superadmin" sees the first phone owned by "casdoor:fleet-owner-a"

  Scenario: a superadmin reaches the Fleet entitlements console (ALLOW)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/admin/fleet-entitlements"
    Then "superadmin" sees the "fleet-entitlements-view" console

  Scenario: a superadmin grants then revokes a fleet entitlement
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/fleet-entitlements"
    Then "superadmin" sees the "fleet-entitlements-view" console
    When "superadmin" grants a fleet entitlement to "casdoor:fleet-owner-a"
    Then "superadmin" sees a fleet entitlement for "casdoor:fleet-owner-a"
    When "superadmin" revokes the fleet entitlement for "casdoor:fleet-owner-a"
    Then "superadmin" sees no fleet entitlement for "casdoor:fleet-owner-a"

  Scenario: the Fleet entitlements menu item is superadmin-only (surfaced vs hidden)
    Given "superadmin" has a seeded session in their own context
    And "admin-domain-a" has a seeded session in their own context
    When "superadmin" navigates to "/admin"
    And "admin-domain-a" navigates to "/admin"
    Then "superadmin" sees the "fleet-entitlements" menu item
    And "admin-domain-a" does not see the "fleet-entitlements" menu item

  Scenario: a domain admin is bounced from the Fleet entitlements console (DENY)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/admin/fleet-entitlements"
    Then "admin-domain-a" is redirected to the login page

  # A domain admin genuinely holds ROLE_ADMIN — yet the entitlement admin surface is
  # hasRole('SUPERADMIN') only, so even the LIST is rejected outright: 403 only, never a 400.
  Scenario: a domain admin's fleet-entitlements read is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/superadmin/fleet-entitlements"
    Then the response status is 403
