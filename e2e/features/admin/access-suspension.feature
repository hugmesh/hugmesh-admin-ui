# ADMIN-SIDE leg of the cross-service "ban -> appeal -> admin approve ->
# access restored" loop. There is NO admin-bff endpoint that lists/decides
# pending appeal RECORDS yet (see the Appeals console's own dg-gap-appeals /
# ap-gap-pending-list helptext — that console adjudicates federation-api
# ModerationRequest rows, a DIFFERENT "appeal" than an account ban) — so the
# admin's real, wired lever over a banned/suspended account is the Delegation
# console's PROFILE access-role suspend/lift, which IS what drives the
# banned/suspended AccountStatus a curtailed user's /bff/me and the login-ui
# appeal short-circuit key off (SuspensionService.reduce: a permanent PROFILE
# suspension -> banned; a timed one -> suspended). See
# hugmesh.net' appeal-redirect.feature (the routing short-circuit +
# access-restored leg) and hugmesh-login-ui's appeal-contact.feature (the
# appeal page itself) for the rest of the loop.
#
# Honesty rules (same as mutations.feature):
#   - The ALLOW write is REAL: the operator drives the actual Delegation
#     console form and the assertion is the row the server actually returned
#     (the suspensions table re-renders from the POST/DELETE response), for
#     BOTH halves of the loop — ban AND lift.
#   - The DENY write is a REAL POST with a bean-valid body -> 403 only.
#   - The cross-domain scenario is victim-creates-first: domain-A bans a REAL
#     user via the BFF and captures that it is domain-A's OWN scoped list;
#     domain-B's scoped list must not contain it (invisible, not leaked) while
#     domain-A's own list still does (the row is real, not lost).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Delegation console PROFILE access-role suspend/lift — the real ban <-> restore lever
  As the admin platform
  I must let only an ADMIN ban and lift a user's Profile access role
  So a banned/suspended account's status is set — and later verifiably restored — by a real, gated action

  Scenario: an admin bans and then lifts a user's Profile access role via the delegation console (ALLOW)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" navigates to "/admin/delegation"
    Then "admin-domain-a" sees the "delegation-view" console
    When "admin-domain-a" bans "e2e-appeal-victim" from the "PROFILE" access role permanently via the delegation console
    Then "admin-domain-a" sees the suspension row for "e2e-appeal-victim" with role "PROFILE"
    When "admin-domain-a" lifts the suspension for "e2e-appeal-victim"
    Then "admin-domain-a" sees no suspension row for "e2e-appeal-victim"

  # Role gate: a mod carries real moderation power but not ADMIN — the
  # sibling-not-superset rule (mirrors the games-services cross-domain DENY
  # pattern in mutations.feature). A bean-valid body so the 403 can only be
  # the authz verdict, never a validation 400.
  Scenario: a mod's suspend-access POST is rejected outright — 403 only
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/access-roles/PROFILE/e2e-deny-probe" with body:
      """
      {"ttlSeconds":null,"reason":"e2e deny probe"}
      """
    Then the response status is 403

  Scenario: domain-B admin cannot see domain-A's Profile ban (invisible, not leaked)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" bans "e2e-cross-domain-victim" from the "PROFILE" access role permanently via the BFF
    Then "admin-domain-b" does not see the suspension for "e2e-cross-domain-victim" in their access-roles list via the BFF
    And "admin-domain-a" still sees the suspension for "e2e-cross-domain-victim" in their access-roles list via the BFF
