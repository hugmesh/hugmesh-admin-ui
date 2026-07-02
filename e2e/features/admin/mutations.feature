# REAL WRITE coverage — the consoles above were exercised read-only; this
# feature proves the WRITE path end-to-end for the roles that own it, and that
# every other role's write attempt dies at the BFF.
#
# Honesty rules in force here:
#   - The ALLOW writes are REAL: the operator drives the actual console form and
#     the assertion is the SAME evidence the operator sees (saved confirmation,
#     the row/instance rendered from the server's response).
#   - The DENY writes are REAL POSTs with bean-valid bodies (a 400 can never
#     shadow the authz verdict) → 403 only. No "200 or 403".
#   - Cross-tenant DENYs follow the victim-creates-first oracle: the victim
#     creates the row and captures the REAL server id; the attacker's PUT/DELETE
#     on that id must fail AND the victim must still read the untouched row.
#     Note the expected status is 404, not 403 — the admin-bff deliberately
#     answers "invisible" for another brand's id (AnnouncementService: "another
#     brand's id resolves to empty → 404 (invisible, not a data-leaking 403)").
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Admin console mutations — real writes for the owning role, hard DENY for everyone else
  As the admin platform
  I must accept privileged writes only from the role that owns the surface
  So no sibling, under-privileged or cross-domain operator can mutate what it can merely see

  Scenario: a superadmin creates and then updates an announcement through the console (ALLOW)
    Given "superadmin" is logged in
    When "superadmin" navigates to "/admin/announcements"
    Then "superadmin" sees the "announcements-view" console
    When "superadmin" starts a new announcement
    And "superadmin" titles the announcement "Maintenance window"
    And "superadmin" writes the announcement body "<p>The cluster reboots at 02:00 UTC.</p>"
    And "superadmin" targets the announcement at the Home surface
    And "superadmin" saves the announcement
    Then "superadmin" sees the announcement saved confirmation
    And the announcement "Maintenance window" appears in "superadmin"'s announcements table
    When "superadmin" retitles the announcement to "Maintenance window (rescheduled)"
    And "superadmin" saves the announcement
    Then "superadmin" sees the announcement saved confirmation
    And the announcement "Maintenance window (rescheduled)" appears in "superadmin"'s announcements table

  Scenario: a games-services admin creates a real instance from an offered server (ALLOW)
    Given "games-admin" is logged in
    When "games-admin" navigates to "/admin/games-services"
    Then "games-admin" sees the "games-services-view" console
    When "games-admin" selects the first offered game server
    And "games-admin" names the new instance "world"
    And "games-admin" submits the create-instance form
    Then the instance "world" appears in "games-admin"'s instances list within 30 seconds

  # admin-domain-b carries no games-services role at all, so the URL-level games
  # gate (/bff/games-services/** requires a games role) rejects the POST before
  # the body is even parsed — 403 only, cross-domain or not.
  Scenario: a cross-domain admin's create-instance POST is rejected outright — 403 only
    Given "admin-domain-b" is logged in
    When "admin-domain-b" POSTs to "/bff/games-services/instances" with body:
      """
      {"slug":"e2e-deny-probe","name":"e2e-deny-probe"}
      """
    Then the response status is 403

  Scenario: a cross-domain admin cannot update or delete another brand's announcement (victim-creates-first)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" creates an announcement titled "Brand A internal notice" via the BFF
    And "admin-domain-b" attempts to update the announcement titled "Brand A internal notice" via the BFF
    Then the response status is 404
    When "admin-domain-b" attempts to delete the announcement titled "Brand A internal notice" via the BFF
    Then the response status is 404
    And "admin-domain-a" still reads the announcement titled "Brand A internal notice" via the BFF
