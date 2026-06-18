# MULTIUSER-SITUATIONAL coverage — a domain admin acting over their OWN domain.
#
# A domain admin may reach and operate the domain-scoped consoles (the admin
# allowlist, OIDC provider-roles, node-storage, games-services if granted). The
# admin-bff scopes every mutation to the caller's domain; here we assert the
# admin reaches their own domain's console (display) and that the same-domain
# read succeeds at the BFF (200).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @multiuser-situational
Feature: A domain admin operating over their own domain
  As a domain admin
  I want to reach and read my own domain's admin consoles
  So I can administer my brand without superadmin involvement

  Scenario: a domain admin opens their admin allowlist console (ALLOW)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/"
    Then "admin-domain-a" sees the "admin-view" console

  Scenario: a domain admin reads their own domain OIDC provider-roles (BFF 200)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/admin/oidc-provider-roles"
    Then the response status is 200

  Scenario: a games-services admin creates within their own domain (control enabled)
    Given "games-admin" has a seeded session
    When "games-admin" navigates to "/games-services"
    Then "games-admin" sees the "games-services-view" console
    And "games-admin" sees the "gs-create" control enabled
