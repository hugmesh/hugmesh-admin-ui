# USER-SITUATIONAL coverage — the games app-store operator console's ALLOW +
# DENY-with-helptext surface (the requirement's disabled+helptext class).
#
# gamesServicesGuard admits BOTH a games-services ADMIN and a games-services
# RUNNER, but the console greys-out the create form for a runner: every create
# control binds [disabled]="!canCreate()" + [attr.aria-disabled], and a
# `gs-runner-help` span explains why (src/app/games-services/
# games-services.component.html). So both roles see the view (guard ALLOW), but
# only the admin sees the create action ENABLED.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @user-situational
Feature: Games-services console — guard ALLOW for both roles, create gated to admin
  As the games app-store operator console
  I must let a runner manage instances but gate creation to the games admin
  So a mod-delegated runner cannot create new server instances

  Scenario: a games-services admin sees the create action enabled (ALLOW)
    Given "games-admin" has a seeded session
    When "games-admin" navigates to "/games-services"
    Then "games-admin" sees the "games-services-view" console
    And "games-admin" sees the "gs-create" control enabled

  Scenario: a games-services runner sees the console but create is disabled with helptext (DENY-restricted)
    Given "games-runner" has a seeded session
    When "games-runner" navigates to "/games-services"
    Then "games-runner" sees the "games-services-view" console
    And "games-runner" sees the "gs-create" control disabled
    And "games-runner" sees the "gs-slug" control disabled
    And "games-runner" sees help text "gs-runner-help"

  Scenario: a plain user is bounced from the games-services console (DENY)
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/games-services"
    Then "plain-user" is redirected to the login page

  # ── The OTHER games surface: the SUPERADMIN-only GLOBAL catalog + per-domain
  # offers at /bff/superadmin/games-services/** (admin-bff
  # GamesCatalogSuperadminController, every method hasRole('SUPERADMIN')), which
  # is NOT the per-domain operator console above — a games-services ADMIN curates
  # instances for their brand and is still refused the global catalog. No admin-ui
  # view drives this surface (only the generated API client exists), so the role
  # matrix is pinned at the BFF with real logins.
  #
  # Door posture (hugmesh-generator#347 decision 28 = D, seeded 2026-09-17 in
  # route-access 20-schema.sql as a DENY row at the PUBLIC fe door with
  # mfa_required=true): a non-privileged principal is refused AT THE GATEWAY,
  # while ROLE_ADMIN / ROLE_SUPERADMIN short-circuit the gateway's decide() and
  # are answered by admin-bff itself — so a superadmin still reads the catalog at
  # the public door today, a plain admin is refused one layer in, and only the D8
  # privileged MFA floor (APP_MFA_ENFORCE_PRIVILEGED_FLOOR, default off) will bind
  # a superadmin on this row once flipped. The STATUS is the same 403 for admin,
  # games-admin, mod and user; the layer differs (X-Route-Denied present only on
  # the gateway refusal), which this suite does not pin. Re-pin the superadmin row
  # when the floor flag flips: it becomes a step-up 403, not a 200.

  @issue:generator-347
  Scenario: a superadmin reads the global games catalog at the public door — 200
    Given "superadmin" is logged in
    When "superadmin" GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 200

  @issue:generator-347
  Scenario: a games-services admin is refused the global games catalog (per-domain operator, not global curator) — 403
    Given "games-admin" is logged in
    When "games-admin" GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 403

  @issue:generator-347
  Scenario: a domain admin is refused the global games catalog — 403
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 403

  @issue:generator-347
  Scenario: a games-services runner is refused the global games catalog — 403
    Given "games-runner" is logged in
    When "games-runner" GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 403

  @issue:generator-347
  Scenario: a mod is refused the global games catalog — 403
    Given "mod-user" is logged in
    When "mod-user" GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 403

  @issue:generator-347
  Scenario: a plain user is refused the global games catalog — 403
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 403

  @issue:generator-347
  Scenario: an unauthenticated read of the global games catalog is rejected — 401
    Given a clean session
    When the unauthenticated client GETs "/bff/superadmin/games-services/catalog"
    Then the response status is 401
