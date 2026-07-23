# The REAL "grant a platform role" lever — admin-bff's standalone Casdoor role
# grant/revoke (AdminController#grantRole / #revokeRole:
# POST/DELETE /bff/admin/roles/{roleName}/{user}). This is a DIFFERENT, more
# direct lever than access-suspension.feature's PROFILE/ROLE_MATRIX/ROLE_MASTODON
# ban-lift: it calls CasdoorAdminClient.add/removeUserFromRole DIRECTLY (no
# access_suspension row, no reconcile loop, no homeserver seam) and
# best-effort revokes the grantee's live custody JWT so a freshly-minted token
# picks the new role up immediately (GatewayRevocationClient.revokeSubject),
# rather than waiting out the ~1h natural TTL.
#
# NOTE ON THE DELEGATION CONSOLE: the Delegation console's "Grant / revoke an
# arbitrary role" control (dg-gap-role-grant) is rendered aria-disabled with
# helptext claiming "General role grant / revoke has no endpoint — roles are
# granted in Casdoor via the reconcile loop." That claim is STALE against the
# current admin-bff-api: AdminController really does expose exactly this
# endpoint (GRANTABLE_ROLE_PATTERN includes ROLE_MATRIX, ROLE_MASTODON,
# ROLE_MOD, ROLE_ADMIN, ROLE_GAMES, ROLE_IMAGE_BUILDER, the *_DOMAINLOCKED and
# *_EXTERNAL_CLIENT markers). This feature proves the real BFF-level behaviour
# directly — the same "the console is display-only; the BFF is the real gate"
# idiom access-suspension.feature and mutations.feature already use for their
# own BFF-only legs — rather than driving a control the UI has (incorrectly)
# disabled.
#
# This is the ADMIN-SIDE leg of the cross-service "grant ROLE_MATRIX -> Matrix
# surface unlocks" loop; see hugmesh-matrix-ui's
# access/role-grant-unlock-loop.feature for the leg that proves this SAME
# grant lever causally flips one target user's Matrix reachability from
# denied to allowed (same identity, before vs. after a real grant — not two
# independently-seeded personas that happen to differ).
#
# Honesty rules (same standard as access-suspension.feature):
#   - The ALLOW write is REAL: a real POST/DELETE against a real (uniquified)
#     user, and the assertion is the server's own response body
#     (granted/revoked + role + user) — never a local echo.
#   - The DENY write is a REAL POST against a bean-valid path (both role and
#     user match their @Pattern) -> 403 only, so the verdict can only be the
#     authz chain, never a validation 400 in disguise.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Standalone Casdoor role grant/revoke — the real ROLE_MATRIX grant lever
  As the admin platform
  I must let only an ADMIN grant or revoke a platform-access role directly in Casdoor
  So the cross-service unlock loop (grant ROLE_MATRIX -> Matrix surface reachable) has a real, gated origin

  Scenario: an admin grants and then revokes ROLE_MATRIX for a user via the BFF (ALLOW)
    Given "admin-domain-a" is logged in in their own context
    When "admin-domain-a" grants the "ROLE_MATRIX" role to "e2e-role-grant-victim" via the BFF
    Then the role response reports "granted" role "ROLE_MATRIX" for "e2e-role-grant-victim"
    When "admin-domain-a" revokes the "ROLE_MATRIX" role from "e2e-role-grant-victim" via the BFF
    Then the role response reports "revoked" role "ROLE_MATRIX" for "e2e-role-grant-victim"

  # A mod carries real moderation power but not ADMIN — the sibling-not-superset
  # rule (mirrors access-suspension.feature's own mod-DENY scenario). The path
  # (role + user) is bean-valid so the 403 can only be the authz verdict.
  Scenario: a mod's role-grant POST is rejected outright — 403 only
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/roles/ROLE_MATRIX/e2e-deny-probe" with body:
      """
      {}
      """
    Then the response status is 403
