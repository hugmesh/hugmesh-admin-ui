# Non-happy-path BFF auth coverage — the admin-bff is the real gate behind every
# display-only console. These scenarios assert the rejection paths: anonymous,
# under-privileged, and cross-tier.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @security
Feature: admin-bff authorization gates — anonymous and under-privileged rejection
  As the admin-bff
  I must reject privileged calls that lack the right role or scope
  So the display-only consoles can never be the security boundary

  Scenario: unauthenticated read of the superadmin Domains surface is rejected — 401
    Given a clean session
    When the unauthenticated client GETs "/bff/admin/superadmin/domains"
    Then the response status is 401

  Scenario: unauthenticated read of the Device Licenses registry is rejected — 401
    Given a clean session
    When the unauthenticated client GETs "/bff/admin/device-licenses"
    Then the response status is 401

  Scenario: a plain user reading the superadmin Domains surface is forbidden — 403
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/admin/superadmin/domains"
    Then the response status is 403

  Scenario: a domain admin reading a superadmin-only surface is forbidden — 403
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/admin/egress-vpn"
    Then the response status is 403

  # A REAL POST to the real create endpoint (POST /bff/games-services/instances,
  # @PreAuthorize GAMES_SERVICES_ADMIN — the runner passes the URL-level games
  # gate but MUST fail the method gate). The body is bean-valid so a 400 can
  # never shadow the verdict: 403 is the only honest outcome.
  Scenario: a games-services runner POSTing to create is forbidden by the BFF — 403
    Given "games-runner" is logged in
    When "games-runner" POSTs to "/bff/games-services/instances" with body:
      """
      {"slug":"e2e-deny-probe","name":"e2e-deny-probe"}
      """
    Then the response status is 403

  # ── MOD: the SIBLING role, not a subset. A mod holds real power over the mod
  #    consoles but every /bff/admin/** call must 403 (the URL gate requires
  #    ROLE_ADMIN|ROLE_SUPERADMIN — SecurityConfig, admin-bff). ────────────────

  Scenario: a mod reading the admin Announcements surface is forbidden — 403
    Given "mod-user" is logged in
    When "mod-user" GETs "/bff/admin/announcements"
    Then the response status is 403

  Scenario: a mod reading the superadmin Domains surface is forbidden — 403
    Given "mod-user" is logged in
    When "mod-user" GETs "/bff/admin/superadmin/domains"
    Then the response status is 403

  Scenario: a mod POSTing an announcement is forbidden — 403
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/announcements" with body:
      """
      {"title":"mod deny probe","body_html":"<p>probe</p>","state":"draft","target_home":true}
      """
    Then the response status is 403
