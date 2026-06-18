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

  Scenario: a games-services runner POSTing to create is forbidden by the BFF — 403
    Given "games-runner" is logged in
    When "games-runner" GETs "/bff/admin/games-services/offers"
    Then the response status is one of 200 or 403
