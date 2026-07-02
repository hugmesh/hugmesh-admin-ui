# CROSS-USER ISOLATION coverage — the multi-tenant keystone. A domain-A admin
# must be DENIED on a domain-B resource, and a plain domain admin must be DENIED
# on every superadmin-only console. Two identities coexist in one scenario (each
# in its own context via "seeded session in their own context") so the isolation
# is asserted with both users live, not by swapping a single session.
#
# The display-layer DENY (guard bounce) is backed by an API-layer DENY: the
# admin-bff re-enforces domain scope, so a cross-domain read answers a
# deterministic 404 — another brand's id resolves to EMPTY (invisible, not a
# data-leaking 403; AnnouncementService) — even if the UI were bypassed.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @cross-user
Feature: Cross-domain isolation — domain admins cannot reach each other's resources
  As the multi-tenant admin platform
  I must isolate each brand's admin surface from every other brand
  So a compromised domain-A admin token cannot read or mutate domain-B

  # Victim-creates-first: admin-A creates a REAL row and captures the REAL
  # server id; admin-B's read of that id must answer exactly 404 (the admin-bff
  # resolves another brand's id to empty — invisible by design) AND the row
  # stays readable, untouched, by its owner. Real logins (not seeded sessions)
  # because the BFF calls need each caller's own HttpOnly bff_ cookie.
  Scenario: domain-B admin cannot read domain-A's announcement via the BFF (404-invisible)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" creates an announcement titled "Domain A isolation probe" via the BFF
    And "admin-domain-b" attempts to read the announcement titled "Domain A isolation probe" via the BFF
    Then the response status is 404
    And "admin-domain-a" still reads the announcement titled "Domain A isolation probe" via the BFF

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

  # The ONE place crossing domains is CORRECT: SUPERADMIN's DomainScope is the
  # null predicate, so it reads BOTH brands' rows where each domain admin reads
  # only its own. Victim-creates-first both ways: each admin creates a REAL row
  # in their own brand, then all three read their own scoped list.
  Scenario: a superadmin reads both brands' resources where each domain admin sees only its own (ALLOW)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    And "superadmin" is logged in in their own context
    When "admin-domain-a" creates an announcement titled "Domain A bulletin" via the BFF
    And "admin-domain-b" creates an announcement titled "Domain B bulletin" via the BFF
    Then the announcement "Domain A bulletin" appears in "superadmin"'s announcements list within 15 seconds
    And the announcement "Domain B bulletin" appears in "superadmin"'s announcements list within 15 seconds
    And "admin-domain-a"'s announcements list contains "Domain A bulletin"
    And "admin-domain-a"'s announcements list does not contain "Domain B bulletin"
    And "admin-domain-b"'s announcements list contains "Domain B bulletin"
    And "admin-domain-b"'s announcements list does not contain "Domain A bulletin"
