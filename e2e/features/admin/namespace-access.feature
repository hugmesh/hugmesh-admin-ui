# FUNCTIONAL/WRITE coverage for the Namespace Access console (admin-ui #wave2). The
# console's write seam is AdminController's POST /bff/admin/namespace-access
# (ROLE_ADMIN), which grants a user access to one of AccountStore.NAMESPACES, scoped to
# the granting admin's own domain (namespaceOut reads store.allGrants(scope.domain()) for
# a domain-scoped caller).
#
# Honesty rules in force here:
#   - The ALLOW write is REAL: admin-domain-a drives the actual console form and the
#     assertion is the SAME evidence the operator sees — the granted user's row rendered
#     in the grants list from the server's response.
#   - The role DENY is a REAL POST with a bean-valid body (a valid namespace from
#     AccountStore.NAMESPACES, so a 400 can never shadow the authz verdict) → 403 only.
#     mod-user genuinely holds ROLE_MOD (a sibling role with real moderation power, not a
#     no-role probe) and is still denied — admin-only means admin-only.
#   - The cross-domain isolation DENY follows victim-creates-first: admin-domain-a (the
#     victim/creator) grants a REAL, server-issued row via the BFF; admin-domain-b then
#     reads its OWN domain-scoped grants list and must NOT see that row (the admin-bff
#     domain-scopes the read, not merely obscures it in the UI) — and the row is confirmed
#     still visible to its owner, admin-domain-a, so this is a scoping proof, not a
#     "vanished data" false negative.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Namespace Access console — real grant writes, admin-only, domain-scoped

  Scenario: a domain admin grants a user access to a namespace through the console (ALLOW)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" navigates to "/namespaces"
    Then "admin-domain-a" sees the "ns-view" console
    When "admin-domain-a" grants namespace access to a user through the console
    Then the granted user appears in "admin-domain-a"'s namespace grants list

  Scenario: a mod cannot grant namespace access — admin-only (DENY)
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/namespace-access" with body:
      """
      {"user":"e2e-deny-probe-ns@example.test","namespace":"observability"}
      """
    Then the response status is 403

  Scenario: a cross-domain admin's namespace grants list does not include another brand's grant (victim-creates-first)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" grants namespace access to a user via the BFF
    Then the granted user does not appear in "admin-domain-b"'s namespace grants list (via the BFF)
    And the granted user appears in "admin-domain-a"'s namespace grants list (via the BFF)
