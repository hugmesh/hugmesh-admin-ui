# MID-SESSION ROLE REVOKE — role-grant.feature proves the grant/revoke lever and
# documents that AdminController#revokeRole best-effort revokes the grantee's LIVE
# custody JWT (GatewayRevocationClient) so the change bites immediately. But no
# scenario had a LIVE victim session observing the consequence — the route-matrix
# only tests statically-seeded personas, never a role flipping under an OPEN session.
# This closes that: a real ROLE_ADMIN login that works, a superadmin revoke, and the
# same session's next admin read cut off — then a re-grant to restore the seed.
#
# @cluster — needs a live Casdoor (a real custody JWT to revoke); ships dark.
@cluster @admin-ui @mutation
Feature: Mid-session admin role revoke cuts the live victim off

  Scenario: revoking a live admin's role cuts their open session, and re-granting restores it
    Given "superadmin" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    # ── the victim's live session really has admin access ──
    When "admin-domain-a" GETs "/bff/admin/allowlist"
    Then the response status is 200
    # ── superadmin revokes ROLE_ADMIN from the REAL victim (server body oracle) ──
    When "superadmin" revokes the "ROLE_ADMIN" role from the live victim "admin-domain-a" via the BFF
    Then the role response reports "revoked" role "ROLE_ADMIN" for "admin-domain-a"
    # ── the SAME open session's next admin read is now denied (custody JWT revoked) ──
    When "admin-domain-a" GETs "/bff/admin/allowlist"
    Then "admin-domain-a"'s live admin read is cut by the revocation
    # ── re-grant restores the seed (a fresh token would pick admin back up) ──
    When "superadmin" re-grants the "ROLE_ADMIN" role to the live victim "admin-domain-a" via the BFF
    Then the role response reports "granted" role "ROLE_ADMIN" for "admin-domain-a"
