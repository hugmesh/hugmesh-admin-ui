# READ-ONLY coverage for the superadmin Phone fleet console (admin.routes.ts
# `/phone-fleet` → PhoneFleetComponent, phone-fleet-view). SUPERADMIN-only
# (superadminGuard + the BFF re-enforces the role on every read): the console lists
# every MDM phone that has INGESTED (self-reported its provisioning snapshot to
# /bff/superadmin/phone-devices). There is deliberately NO write seam — enrolment and
# profile management happen device-side via the phone wizard — so the live lanes here
# are the guard ALLOW/DENY, the menu visibility split, the BFF's own role gate, and a
# list-read honesty check.
#
# Honesty rules in force here:
#   - PATHS ARE HOST-ABSOLUTE (/admin/phone-fleet): the harness drives the HOST front
#     door and the host mounts ADMIN_ROUTES at /admin — an un-prefixed path would fall
#     into the host's wildcard redirect and never touch superadminGuard (see
#     route-matrix.feature's own header).
#   - The list-read scenario asserts the DOM against the SAME live read the console
#     performs (the logged-in superadmin's own /bff/superadmin/phone-devices response):
#     one rendered row per reported phone when the fleet is non-empty, the explicit
#     "No phones have ingested yet" empty state when it is empty — both branches are
#     exact assertions of what the BFF reported, never a bare "element exists".
#   - The DENY is a REAL GET as a genuine ROLE_ADMIN (not a no-role probe) → 403 only:
#     the registry read is superadmin-specific, not "any admin".
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @phone-fleet
Feature: Phone fleet console — superadmin-only read-only MDM phone registry

  Scenario: a superadmin reaches the Phone fleet console (ALLOW)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console

  Scenario: the fleet table mirrors the live phone-devices read (ingested phones render)
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    And the phone fleet list mirrors the live phone-devices read for "superadmin"

  Scenario: the Phone fleet menu item is superadmin-only (surfaced vs hidden)
    Given "superadmin" has a seeded session in their own context
    And "admin-domain-a" has a seeded session in their own context
    When "superadmin" navigates to "/admin"
    And "admin-domain-a" navigates to "/admin"
    Then "superadmin" sees the "phone-fleet" menu item
    And "admin-domain-a" does not see the "phone-fleet" menu item

  Scenario: a domain admin is bounced from the Phone fleet console (DENY)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/admin/phone-fleet"
    Then "admin-domain-a" is redirected to the login page

  # A domain admin genuinely holds ROLE_ADMIN — this is not a no-role probe — yet the
  # phone-devices read is hasRole('SUPERADMIN') only, so even the LIST is rejected
  # outright: 403 only, the authz verdict, never a validation 400.
  Scenario: a domain admin's phone-devices read is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/superadmin/phone-devices"
    Then the response status is 403

  # ── Wave-2: co-equal Azure Intune MDM provider surface ──────────────────────
  # Each provider scenario re-reads the SAME live /bff/superadmin/phone-devices list the console
  # fetched, picks a row by its DEVICE-REPORTED mdmProvider, expands it, and holds the DOM to what
  # the BFF actually reported — the provider chip label, the Intune device id (azure only), and the
  # unlock-asymmetry note (locked azure only). The picker throws loudly when the seeded fleet has no
  # such device, so a mis-seeded cluster fails the step rather than passing vacuously.
  Scenario: an azure-intune phone renders the Azure Intune chip and its Intune device id
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    And "superadmin" sees the "Azure Intune" provider chip and its Intune device id for an azure-reported phone

  Scenario: a headwind phone renders the Headwind chip with no Intune id and no asymmetry note
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    And "superadmin" sees the "Headwind" provider chip and no Intune id for a headwind-reported phone

  Scenario: a LOCKED azure-intune phone shows the unlock-asymmetry note
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/phone-fleet"
    Then "superadmin" sees the "phone-fleet-view" console
    And "superadmin" sees the Azure unlock-asymmetry note for a locked azure-intune phone
