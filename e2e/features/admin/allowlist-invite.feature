# ADMIN-INVITE leg of the cross-service "admin invites -> user registers ->
# lands with correct access" loop (wave 3). This console (admin.component.ts)
# is the front door of the loop: POST /bff/admin/allowlist writes the DURABLE
# allowlist row snapdragon-login-ui's registration gate reads
# (AuthController.registerGoogle/registerDiscord -> store.isEmailInvited /
# isDiscordInvited); a handle absent here is refused registration outright.
# The rest of the loop (the invited identity actually registering, and the
# uninvited-refusal) is covered on the OTHER side of the gate, in
# snapdragon-login-ui's e2e suite (register-invite-gate.feature) — that suite
# seeds through THIS same real POST /bff/admin/allowlist endpoint, so both
# repos exercise the identical, real cross-service contract.
#
# Honesty rules (same as mutations.feature):
#   - The ALLOW writes are REAL: the operator drives the actual console form
#     and the assertion is the SAME evidence the operator sees — the invited
#     handle rendered in the allowlist list the BFF's response returned.
#   - The invite itself is the privileged action: only ADMIN may call
#     POST /bff/admin/allowlist (AdminController#invite,
#     @PreAuthorize("hasRole('ADMIN')")). The DENY half lives in
#     security/bff-auth-gates.feature (a REAL POST with a bean-valid body ->
#     403 only, for the mod sibling role and a plain user), matching how this
#     suite already splits UI-mutation ALLOWs from BFF-security-gate DENYs.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Admin console invite — the durable allowlist row the registration gate reads (ALLOW)
  As an admin
  I must be able to invite a Gmail address or Discord username onto the platform
  So that an admin-invited identity — and only an admin-invited identity — can register

  Scenario: an admin invites a Gmail identity via the console (ALLOW)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" navigates to "/admin"
    Then "admin-domain-a" sees the "admin-view" console
    When "admin-domain-a" invites the Gmail address named "invited-gmail" to the platform
    Then the Gmail address named "invited-gmail" appears in "admin-domain-a"'s allowlist

  Scenario: an admin invites a Discord identity via the console (ALLOW)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" navigates to "/admin"
    Then "admin-domain-a" sees the "admin-view" console
    When "admin-domain-a" invites the Discord username named "invited-discord" to the platform
    Then the Discord username named "invited-discord" appears in "admin-domain-a"'s allowlist
