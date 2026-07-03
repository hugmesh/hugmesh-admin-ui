# FUNCTIONAL/WRITE coverage for the Superadmin Domains console (admin-ui #wave2). The
# console's write seam is DomainRegistryController's POST /bff/admin/domains
# (SUPERADMIN-only), which registers a brand/domain row in the runtime domain_registry —
# the twin of the build-time brands/domains.conf. There is no delete in this MVP surface,
# only register + list, so this feature proves the register write end-to-end.
#
# Honesty rules in force here:
#   - The ALLOW write is REAL: superadmin drives the actual console form and the
#     assertion is the SAME evidence the operator sees — the freshly-registered domain
#     rendered in the domains list from the server's response.
#   - The DENY is a REAL POST with a bean-valid body (a 400 can never shadow the authz
#     verdict) → 403 only. admin-domain-a genuinely holds ROLE_ADMIN (not a no-role probe)
#     and is still denied — SUPERADMIN is a strictly narrower role than ADMIN here, not a
#     superset, so this proves the guard gates on the SPECIFIC role, not "any admin".
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Superadmin Domains console — real domain registration, superadmin-only

  Scenario: a superadmin registers a new domain through the console (ALLOW)
    Given "superadmin" is logged in
    When "superadmin" navigates to "/superadmin/domains"
    Then "superadmin" sees the "superadmin-domains-view" console
    When "superadmin" registers a new domain through the console
    Then "superadmin" sees the registered domain in the domains list

  # A domain admin genuinely holds ROLE_ADMIN — this is not a no-role probe — yet
  # DomainRegistryController requires ROLE_SUPERADMIN specifically, so the POST must
  # still be rejected outright: 403 only, before the body is ever persisted.
  Scenario: a domain admin's create-domain POST is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" POSTs to "/bff/admin/domains" with body:
      """
      {"clusterDomain":"e2e-deny-probe-domains.example.test"}
      """
    Then the response status is 403
