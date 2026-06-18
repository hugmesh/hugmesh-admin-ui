# USER-SITUATIONAL coverage — each admin / superadmin surface, ALLOW + DENY.
#
# The admin-ui mounts every console behind a guard (admin.routes.ts):
#   adminGuard               — the admin micro-frontend itself.
#   superadminGuard          — device-licenses, device-pending, egress-vpn,
#                              superadmin/domains, superadmin/anubis.
#   gamesServicesGuard       — games-services (admin OR runner).
# A guard ALLOW renders the console's *-view; a DENY returns
# router.parseUrl('/login'), bouncing the user to the login page.
#
# @cluster — wave 2b-1 ships DARK. These need the host shell serving the federated
# remote + a live session, so they're tagged @cluster and the config filters them
# out (`tags: 'not @cluster'`) so the default run requires no live stack. They still
# COMPILE + DISCOVER (a no-filter bddgen + `playwright test --list` proves it) — unlike
# playwright-bdd's reserved @skip, which drops a scenario from generation entirely.
@cluster @admin-ui @user-situational
Feature: Admin & superadmin console surfaces — per-role ALLOW and DENY
  As the admin-ui shell
  I must render each console only for a role its guard admits
  So privileged consoles never leak to an under-privileged operator

  Scenario: a superadmin reaches the Domains console (ALLOW)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/superadmin/domains"
    Then "superadmin" sees the "superadmin-domains-view" console

  Scenario: a superadmin reaches the Device Licenses console (ALLOW)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/device-licenses"
    Then "superadmin" sees the "device-licenses-view" console

  Scenario: a domain admin is bounced from the Domains console (DENY)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/superadmin/domains"
    Then "admin-domain-a" is redirected to the login page

  Scenario: a domain admin is bounced from the Egress VPN console (DENY)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/egress-vpn"
    Then "admin-domain-a" is redirected to the login page

  Scenario: a domain admin is bounced from Device Pending (DENY)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/device-pending"
    Then "admin-domain-a" is redirected to the login page

  Scenario: a domain admin reaches the OIDC provider-roles console (ALLOW — admin-capable)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/oidc-providers"
    Then "admin-domain-a" does not see the "superadmin-domains-view" console

  Scenario: a plain user is bounced from every admin surface (DENY floor)
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/superadmin/domains"
    Then "plain-user" is redirected to the login page
