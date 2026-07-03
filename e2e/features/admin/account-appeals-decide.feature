# FUNCTIONAL/WRITE coverage for the account-ban Appeals-decide console (admin-ui #65,
# admin-bff #189 — wave 3). DISTINCT from features/admin/appeals-decide.feature (which
# decides federation-api ModerationRequest rows, i.e. CONTENT moderation): this console
# is the ACCOUNT-level domain — AccountAppealAdminController's
# POST /bff/admin/account-appeals/{id}/decide?status=APPROVED|DENIED, which an ADMIN or
# SUPERADMIN drives from AccountAppealsComponent (/admin/account-appeals). An APPROVE
# decide does not merely flip a status column — it clears the appellant's underlying
# access_suspension PROFILE row FIRST (SuspensionService.clearByHandle), so "access
# restored" is asserted here as a REAL, re-read server state, never assumed from the
# decide call's 200 alone.
#
# Every scenario is victim-creates-first: the appellant submits their OWN real appeal
# via POST /bff/me/appeal (capturing the server-resolved id + handle — never a
# fabricated one), and the banning admin targets that EXACT captured handle so the
# later clearByHandle restore is measured against a row the platform itself created,
# not a probe.
#
# Honesty rules in force here:
#   - ALLOW (approve): a REAL PENDING appeal, banned first via the real BFF suspend
#     endpoint, is approved through the actual console button; the assertion is BOTH
#     the SAME evidence the operator sees (the row moved into the decided table with
#     status APPROVED, and out of the pending list) AND the underlying suspension
#     re-read via the BFF to confirm it is genuinely gone — an approve that didn't
#     restore anything would fail this second check even if the decide call itself
#     returned 200.
#   - ALLOW (deny): the sibling case — a real PENDING appeal is denied through the
#     console, and the assertion proves the underlying suspension is STILL active
#     (deny must never restore access).
#   - SUPERADMIN cross-domain: admin-domain-b bans + appeals against ITS OWN account
#     (domain-b); superadmin — who carries no domain-b affiliation — decides it
#     through the console, proving the unscoped SUPERADMIN reach this surface
#     documents (PrincipalDomain#superadmin), not merely an own-domain admin path.
#   - DENY (MOD): the design deliberately excludes MOD (AccountAppealAdminController's
#     own javadoc: MOD cannot ban/unban an account, so it has no business approving an
#     appeal against one). mod-user genuinely holds ROLE_MOD — not a no-role probe —
#     and attacks a REAL pending id a real appellant (plain-user) just created; the
#     assertion is the REAL BFF response code (never inferred from the console simply
#     not rendering the route, which would only prove the UI hides it, not that the
#     server enforces it) AND the appeal is re-read afterwards to prove the attempt
#     changed nothing.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Account-ban Appeals console — real approve/deny writes, ADMIN/SUPERADMIN only

  Scenario: an admin approves a real pending account-ban appeal — access is restored (ALLOW)
    Given "mod-user" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    When "mod-user" submits an account-ban appeal via the BFF
    And "admin-domain-a" bans "mod-user"'s account permanently via the BFF
    And "admin-domain-a" navigates to "/account-appeals"
    Then "admin-domain-a" sees the "account-appeals-view" console
    When "admin-domain-a" approves the pending appeal from "mod-user" through the console
    Then "admin-domain-a" sees the appeal from "mod-user" decided as "APPROVED"
    And "admin-domain-a" no longer sees an active PROFILE suspension for "mod-user" via the BFF

  Scenario: an admin denies a real pending account-ban appeal — access stays restricted (ALLOW, deny leg)
    Given "mod-user" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    When "mod-user" submits an account-ban appeal via the BFF
    And "admin-domain-a" bans "mod-user"'s account permanently via the BFF
    And "admin-domain-a" navigates to "/account-appeals"
    When "admin-domain-a" denies the pending appeal from "mod-user" through the console
    Then "admin-domain-a" sees the appeal from "mod-user" decided as "DENIED"
    And "admin-domain-a" still sees an active PROFILE suspension for "mod-user" via the BFF

  Scenario: a superadmin approves another brand's account-ban appeal — cross-domain reach (ALLOW)
    Given "admin-domain-b" is logged in in their own context
    And "superadmin" is logged in in their own context
    When "admin-domain-b" submits an account-ban appeal via the BFF
    And "admin-domain-b" bans "admin-domain-b"'s account permanently via the BFF
    And "superadmin" navigates to "/account-appeals"
    Then "superadmin" sees the "account-appeals-view" console
    When "superadmin" approves the pending appeal from "admin-domain-b" through the console
    Then "superadmin" sees the appeal from "admin-domain-b" decided as "APPROVED"
    And "superadmin" no longer sees an active PROFILE suspension for "admin-domain-b" via the BFF

  # MOD is deliberately excluded from this decide surface — proven at the BFF, not the
  # UI (a route-guard DENY only proves the console is hidden, not that the server
  # would reject the call if reached another way).
  Scenario: a mod cannot decide an account-ban appeal — the 403 is real, not UI-hidden (DENY)
    Given "plain-user" is logged in in their own context
    And "mod-user" is logged in in their own context
    When "plain-user" submits an account-ban appeal via the BFF
    And "mod-user" attempts to decide the appeal from "plain-user" via the BFF
    Then the response status is 403
    And "plain-user" still has a pending account-ban appeal via the BFF
