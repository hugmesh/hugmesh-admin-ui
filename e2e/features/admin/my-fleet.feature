# FLEET-OWNER console coverage (my-fleet.feature). The PUBLIC /bff/admin/phone-fleet plane where
# a NON-superadmin FLEET_ADMIN (or ADMIN) manages ONLY THEIR OWN phones — the tenancy-walled twin
# of the superadmin phone-fleet console. The admin-ui route /admin/my-fleet → MyFleetComponent
# (my-fleet-view) is guarded by fleetAdminGuard (fleet_admin/admin/superadmin); the BFF is the
# authoritative gate: it re-enforces the role AND the per-subject ENTITLEMENT AND scopes every
# read/mutation to physical_owner = caller AND owner_domain = caller-domain.
#
# Honesty rules (same as phone-management.feature):
#   - PATHS ARE HOST-ABSOLUTE (/admin/my-fleet): the harness drives the HOST front door; an
#     un-prefixed path falls into the host wildcard redirect and never touches fleetAdminGuard.
#   - The list-honesty step re-reads the SAME live /bff/admin/phone-fleet response the console
#     fetched and holds the DOM to it — one row per owned phone, or the explicit empty state.
#   - The lock UI step drives the REAL console control and holds the DOM to the authoritative
#     [data-lock-state] chip the BFF returned — never a bare "element exists".
#   - The DENYs are REAL: a plain (no-fleet) user is bounced by the guard, and a no-role user's
#     GET of the fleet surface is rejected — 403 only, the authz verdict.
#
# @cluster — ships dark; the default config filters `not @cluster` so no live stack is needed
# (a no-filter bddgen + `playwright test --list` still proves every scenario + step parses).
@cluster @admin-ui @my-fleet @fleet-entitlement
Feature: My fleet — fleet-owner console (own devices only, entitlement + owner-within-domain wall)

  Scenario: a fleet owner reaches the My fleet console (ALLOW)
    Given "fleet-owner-a" has a seeded session
    When "fleet-owner-a" navigates to "/admin/my-fleet"
    Then "fleet-owner-a" sees the "my-fleet-view" console

  Scenario: the My fleet list mirrors the live owned phone-fleet read
    Given "fleet-owner-a" is logged in
    When "fleet-owner-a" navigates to "/admin/my-fleet"
    Then "fleet-owner-a" sees the "my-fleet-view" console
    And the my fleet list mirrors the live owned phone-fleet read for "fleet-owner-a"

  Scenario: a fleet owner locks then unlocks one of their own managed phones
    Given "fleet-owner-a" is logged in
    When "fleet-owner-a" navigates to "/admin/my-fleet"
    Then "fleet-owner-a" sees the "my-fleet-view" console
    When "fleet-owner-a" locks the first owned phone with reason "e2e fleet-owner drill"
    Then "fleet-owner-a" sees the first owned phone reported as locked
    When "fleet-owner-a" unlocks the first owned phone
    Then "fleet-owner-a" sees the first owned phone reported as unlocked

  Scenario: a BYOD owned phone's lock control is disabled (not lockable)
    Given "fleet-owner-a" is logged in
    When "fleet-owner-a" navigates to "/admin/my-fleet"
    Then "fleet-owner-a" sees the "my-fleet-view" console
    And "fleet-owner-a" sees the lock control disabled for an unmanaged owned phone

  Scenario: the My fleet console exposes NO superadmin provisioning affordance
    Given "fleet-owner-a" is logged in
    When "fleet-owner-a" navigates to "/admin/my-fleet"
    Then "fleet-owner-a" sees the "my-fleet-view" console
    And "fleet-owner-a" sees no owner-assignment or mark-managed control on the My fleet console

  Scenario: a no-role user is bounced from the My fleet console (DENY)
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/admin/my-fleet"
    Then "plain-user" is redirected to the login page

  # A no-role user genuinely has no FLEET_ADMIN/ADMIN/SUPERADMIN authority, so even the LIST is
  # rejected outright by the coarse path gate: 403 only, never a validation 400.
  Scenario: a no-role user's owned-fleet read is rejected outright — 403 only (DENY)
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/admin/phone-fleet"
    Then the response status is 403
