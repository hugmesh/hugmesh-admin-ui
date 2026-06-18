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
