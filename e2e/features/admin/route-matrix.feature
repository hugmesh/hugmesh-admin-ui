# TABLE-DRIVEN per-role route matrix — every route in src/app/admin.routes.ts ×
# {superadmin, admin (own domain), mod, plain user, signed-out}. The expected
# outcomes are DERIVED FROM THE ACTUAL GUARDS, not guessed:
#
#   - PATHS ARE HOST-ABSOLUTE. The harness drives the HOST front door
#     (playwright.config baseURL), and the host shell
#     (hugmesh.net/src/app/app.routes.ts) mounts ADMIN_ROUTES at
#     path 'admin' — so every remote route is reached as /admin/<child>.
#     An un-prefixed path would fall into the host's `{ path: '**',
#     redirectTo: '' }` wildcard and be resolved by roleHomeGuard (admin →
#     /admin, mod → /mod, user → /user, anonymous → /login), never touching
#     the guard the row claims to test.
#   - The host mounts the whole remote behind adminGuard (session.isAdmin(),
#     i.e. roles includes 'admin'; superadmin seeds carry 'admin' too) → every
#     /admin/** route refuses mod ('mod' is a SIBLING role, not a subset) and
#     the plain user — both signed in, so the host's roleGuard sends them to its
#     denied notice, /home?denied=<url> — and sends the signed-out visitor to
#     /login. That is why the mod / plain / signed-out columns are constant
#     refusal assertions on every row.
#   - superadminGuard (session.isSuperadmin()) additionally protects
#     device-licenses, device-pending, phone-fleet, egress-vpn,
#     superadmin/domains and superadmin/anubis → a plain domain admin bounces
#     there.
#   - gamesServicesGuard admits ONLY games_services_admin | games_services_runner
#     → BOTH the plain admin AND the superadmin bounce from /games-services
#     (neither seed carries a games role; the per-games-role ALLOWs live in
#     games-services-gating.feature).
#   - workloadConsoleGuard is a SERVER-CONFIRMED capability probe for
#     admin/superadmin (render depends on a live workload grant — not statically
#     derivable, so no ALLOW row); its client-side fast-fail for non-admins IS
#     deterministic and is asserted in the dedicated scenario at the bottom.
#
# A "renders" outcome asserts the console root's stable data-testid. A refusal
# of a SIGNED-IN persona asserts the denied notice (/home?denied=<url>, the
# shared refuseNavigation in src/app/guard-refusal.ts, matching the host's
# DENIED_PATH); only the signed-out visitor is sent to /login.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @route-matrix
Feature: Per-role route matrix — every admin route, every persona, ALLOW or refuse
  As the admin-ui route guards
  I must admit each route only to the roles its guard names
  So every persona's reach is exactly the guard chain, route by route

  Scenario Outline: <route> — superadmin <superadmin outcome>; admin <admin outcome>; mod, plain user and signed-out refused
    Given "superadmin" has a seeded session in their own context
    And "admin-domain-a" has a seeded session in their own context
    And "mod-user" has a seeded session in their own context
    And "plain-user" has a seeded session in their own context
    When "superadmin" navigates to "<route>"
    And "admin-domain-a" navigates to "<route>"
    And "mod-user" navigates to "<route>"
    And "plain-user" navigates to "<route>"
    Then "superadmin" <superadmin outcome>
    And "admin-domain-a" <admin outcome>
    And "mod-user" is shown the denied notice
    And "plain-user" is shown the denied notice
    When a signed-out visitor opens "<route>"
    Then the signed-out visitor is redirected to the login page

    # ── adminGuard-only consoles: admin AND superadmin render ────────────────
    Examples:
      | route                 | superadmin outcome                                | admin outcome                                     |
      | /admin                | sees the "admin-view" console                     | sees the "admin-view" console                     |
      | /admin/usage          | sees the "usage-view" console                     | sees the "usage-view" console                     |
      | /admin/namespaces     | sees the "ns-view" console                        | sees the "ns-view" console                        |
      | /admin/delegation     | sees the "delegation-view" console                | sees the "delegation-view" console                |
      | /admin/route-access   | sees the "route-access-view" console              | sees the "route-access-view" console              |
      | /admin/routes         | sees the "route-definitions-view" console         | sees the "route-definitions-view" console         |
      | /admin/isos           | sees the "iso-view" console                       | sees the "iso-view" console                       |
      | /admin/argocd         | sees the "argocd-view" console                    | sees the "argocd-view" console                    |
      | /admin/tasks          | sees the "task-wizard-view" console               | sees the "task-wizard-view" console               |
      | /admin/backup         | sees the "backup-view" console                    | sees the "backup-view" console                    |
      | /admin/recovery       | sees the "recovery-view" console                  | sees the "recovery-view" console                  |
      | /admin/backups        | sees the "backup-history-view" console            | sees the "backup-history-view" console            |
      | /admin/cloud-backups  | sees the "cloud-backups-view" console             | sees the "cloud-backups-view" console             |
      | /admin/announcements  | sees the "announcements-view" console             | sees the "announcements-view" console             |
      | /admin/test-reports   | sees the "test-reports-view" console              | sees the "test-reports-view" console              |
      | /admin/image-gen      | sees the "image-gen-view" console                 | sees the "image-gen-view" console                 |
      | /admin/forum          | sees the "forum-admin-view" console               | sees the "forum-admin-view" console               |
      | /admin/appeals        | sees the "appeals-view" console                   | sees the "appeals-view" console                   |
      | /admin/node-storage   | sees the "storage-pools-view" console             | sees the "storage-pools-view" console             |
      | /admin/oidc-providers | sees the "oidc-provider-roles-view" console       | sees the "oidc-provider-roles-view" console       |
      | /admin/desktop        | sees the "desktop-governance-view" console        | sees the "desktop-governance-view" console        |
      | /admin/security       | sees the "mfa-security-view" console              | sees the "mfa-security-view" console              |
      | /admin/account-appeals | sees the "account-appeals-view" console          | sees the "account-appeals-view" console           |
      | /admin/device-radios  | sees the "device-radios-view" console             | sees the "device-radios-view" console             |
      | /admin/domain-capabilities | sees the "domain-capabilities-view" console  | sees the "domain-capabilities-view" console       |

    # ── superadminGuard consoles: only superadmin renders; admin is refused ─
    Examples:
      | route                     | superadmin outcome                          | admin outcome                     |
      | /admin/device-licenses    | sees the "device-licenses-view" console     | is shown the denied notice        |
      | /admin/device-pending     | sees the "device-pending-view" console      | is shown the denied notice        |
      | /admin/phone-fleet        | sees the "phone-fleet-view" console         | is shown the denied notice        |
      | /admin/egress-vpn         | sees the "egress-vpn-view" console          | is shown the denied notice        |
      | /admin/superadmin/domains | sees the "superadmin-domains-view" console  | is shown the denied notice        |
      | /admin/superadmin/anubis  | sees the "anubis-admin-view" console        | is shown the denied notice        |

    # ── gamesServicesGuard: a games role is REQUIRED — being admin, even
    #    superadmin, is NOT enough (sibling-not-superset again). The games-role
    #    ALLOWs are covered in games-services-gating.feature. ─────────────────
    Examples:
      | route                 | superadmin outcome               | admin outcome                    |
      | /admin/games-services | is shown the denied notice       | is shown the denied notice       |

  # workloadConsoleGuard: mod / plain user / signed-out fast-fail client-side
  # before the server probe — the HOST-level adminGuard on the /admin mount
  # already refuses every non-admin, and the remote guard's own non-admin
  # fast-fail agrees (both: signed in -> /home?denied=<url>, signed out ->
  # /login). (No admin/superadmin
  # row — their outcome depends on a LIVE workload grant, which a static matrix
  # cannot honestly predict; deny for them is a redirect to /admin, not /login.)
  # The logs and terminal sub-routes sit behind the SAME guard, so all three are
  # enumerated.
  Scenario Outline: the hidden workload console route <route> fast-fails every non-admin persona
    Given "mod-user" has a seeded session in their own context
    And "plain-user" has a seeded session in their own context
    When "mod-user" navigates to "<route>"
    And "plain-user" navigates to "<route>"
    Then "mod-user" is shown the denied notice
    And "plain-user" is shown the denied notice
    When a signed-out visitor opens "<route>"
    Then the signed-out visitor is redirected to the login page

    Examples:
      | route                     |
      | /admin/workloads          |
      | /admin/workloads/logs     |
      | /admin/workloads/terminal |
