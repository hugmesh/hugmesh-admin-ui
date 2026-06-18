# CROSS-USER ISOLATION coverage — the multi-tenant keystone. A domain-A admin
# must be DENIED on a domain-B resource, and a plain domain admin must be DENIED
# on every superadmin-only console. Two identities coexist in one scenario (each
# in its own context via "seeded session in their own context") so the isolation
# is asserted with both users live, not by swapping a single session.
#
# The display-layer DENY (guard bounce) is backed by an API-layer DENY: the
# admin-bff re-enforces domain scope, so a cross-domain read returns 403/404
# (fail-closed) even if the UI were bypassed.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @cross-user
Feature: Cross-domain isolation — domain admins cannot reach each other's resources
  As the multi-tenant admin platform
  I must isolate each brand's admin surface from every other brand
  So a compromised domain-A admin token cannot read or mutate domain-B

  Scenario: domain-B admin cannot read domain-A's OIDC provider-roles via the BFF (403/404)
    Given "admin-domain-a" has a seeded session in their own context
    And "admin-domain-b" has a seeded session in their own context
    When "admin-domain-b" GETs "/bff/admin/oidc-provider-roles?domain=domain-a"
    Then the response status is one of 403 or 404

  Scenario: domain-A admin cannot reach any superadmin-only console (DENY)
    Given "admin-domain-a" has a seeded session in their own context
    And "admin-domain-b" has a seeded session in their own context
    When "admin-domain-a" navigates to "/device-licenses"
    Then "admin-domain-a" is redirected to the login page
    And "admin-domain-b" does not see the "device-licenses-view" console

  Scenario: each domain admin reaches only their own admin shell (parallel ALLOW)
    Given "admin-domain-a" has a seeded session in their own context
    And "admin-domain-b" has a seeded session in their own context
    When "admin-domain-a" navigates to "/"
    And "admin-domain-b" navigates to "/"
    Then "admin-domain-a" sees the "admin-view" console
    And "admin-domain-b" sees the "admin-view" console

  Scenario: an unauthenticated client is rejected by the BFF superadmin surface (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/admin/superadmin/domains"
    Then the response status is 401
