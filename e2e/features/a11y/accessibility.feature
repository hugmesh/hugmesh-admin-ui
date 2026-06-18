# Accessibility coverage — the org a11y standard the admin-ui carries: a skip
# link that moves focus to the main region, named ARIA landmarks, roving
# tabindex along the module menu, the capability-gate degraded-state
# announcement, and focus restoration after a route change.
#
# Markup under test (admin-ui src):
#   app.component.html      — `<a class="skip" href="#main">` + `<main id="main"
#                             tabindex="-1">`.
#   admin.component.html    — `<nav aria-label="Admin modules">` + `.nav-link`s,
#                             `<section aria-labelledby="admin-heading"
#                             data-testid="admin-view">`.
#   capability-gate         — role="status" + accessible name (degraded-state
#                             banner).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @a11y
Feature: admin-ui accessibility — skip link, landmarks, roving tabindex, focus restore
  As a keyboard / assistive-tech operator
  I want the admin console to honour the org a11y standard
  So I can reach and operate every surface without a mouse

  Scenario: the skip link is the first tab stop and moves focus to main
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/"
    Then "admin-domain-a" can tab to the skip link
    And activating the skip link moves focus to the main region

  Scenario: the admin module menu is a named landmark
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/"
    Then the admin module menu has an accessible name
    And the "admin-view" view has an accessible name

  Scenario: arrow keys rove focus along the admin module links
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/"
    And "admin-domain-a" focuses the first admin module link
    Then arrow-key navigation moves focus along the admin module links

  Scenario: the capability-gate banner announces unavailability politely
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/argocd"
    Then the capability-gate banner announces unavailability

  Scenario: focus returns to the main region after a guarded navigation
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/superadmin/domains"
    Then "superadmin" sees the "superadmin-domains-view" console
    And focus is restored to the main region after navigation
