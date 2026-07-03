# FUNCTIONAL/WRITE coverage for the Appeals console (admin-ui #wave2). The console's
# single seam is the decide-proxy (POST /bff/admin/moderation/{id}/decide?approve=<bool>),
# which forwards to snapdragon-federation-api's moderation workflow (submit → refer →
# decide). admin-bff proxies ONLY decide — it does not proxy submit/refer — so this
# feature seeds a REAL referred request through the mod-bff moderation triage endpoints
# (POST /bff/mod/moderation, POST /bff/mod/moderation/{id}/refer) before an admin decides
# it, mirroring the platform's real mod→admin escalation chain.
#
# Honesty rules in force here:
#   - The ALLOW is REAL: mod-user (a DIFFERENT actor than the deciding admin) submits and
#     refers the request first — victim-creates-first — then admin-domain-a drives the
#     actual console form and the assertion is the SAME evidence the operator sees (the
#     saved-confirmation note + the decided-table row), AND the mutation's effect is
#     confirmed server-side by re-reading the row back through mod-user's own queue.
#   - The DENY on the role gate (a mod cannot decide, only submit/refer) is checked against
#     a REAL referred id the same mod created seconds earlier — not a fabricated one — and
#     the row is re-read afterwards to prove the attempt truly changed nothing.
#   - The cross-domain DENY (a domain-b admin cannot decide a domain-a request) follows the
#     same victim-creates-first oracle: admin-domain-b's decide POST targets the REAL id
#     mod-user (domain-a) referred, expects the federation-api's documented 404 (a
#     cross-domain id is invisible, not merely forbidden), and the row is re-read to prove
#     it is untouched.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Admin Appeals console — real approve/deny writes, admin-only, domain-scoped

  Scenario: an admin approves a mod-referred appeal through the console (ALLOW)
    Given "mod-user" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    When "mod-user" submits a moderation request via the mod BFF
    And "mod-user" refers the moderation request to admins via the mod BFF
    Then "mod-user" sees the moderation request status "referred"
    When "admin-domain-a" navigates to "/appeals"
    Then "admin-domain-a" sees the "appeals-view" console
    When "admin-domain-a" enters the referred moderation request id in the appeals console
    And "admin-domain-a" approves the appeal
    Then "admin-domain-a" sees the appeal approved confirmation
    And the appeal appears in "admin-domain-a"'s decided appeals table with status "approved"
    And "mod-user" sees the moderation request status "approved"

  Scenario: a mod who referred the appeal cannot decide it themselves — decide is admin-only (DENY)
    Given "mod-user" is logged in
    When "mod-user" submits a moderation request via the mod BFF
    And "mod-user" refers the moderation request to admins via the mod BFF
    And "mod-user" attempts to decide the referred moderation request via the BFF
    Then the response status is 403
    And "mod-user" sees the moderation request status "referred"

  Scenario: a cross-domain admin cannot decide another brand's referred appeal (victim-creates-first)
    Given "mod-user" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "mod-user" submits a moderation request via the mod BFF
    And "mod-user" refers the moderation request to admins via the mod BFF
    And "admin-domain-b" attempts to decide the referred moderation request via the BFF
    Then the response status is 404
    And "mod-user" sees the moderation request status "referred"
