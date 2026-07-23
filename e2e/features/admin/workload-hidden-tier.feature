# WORKLOAD HIDDEN-TIER discoverability — the console's most novel guard: the
# Workload console menu item (admin.component.ts, data-menu="workloads") and its
# route (workloadConsoleGuard) are surfaced ONLY when a server-confirmed capability
# probe passes, which a live SUPERADMIN grant flips on. route-matrix.feature covers
# only the non-admin /login fast-fail; this proves the CAUSAL loop across two live
# users: a grant makes the item + route appear for a specific admin mid-session, and
# a revoke makes the route bounce (to /admin, the admin-has-no-grant DENY) again.
#
# @cluster — needs the host shell + admin-bff + a real superadmin grant; ships dark.
@cluster @admin-ui @workload-hidden-tier
Feature: Workload hidden-tier — a grant reveals the console, a revoke hides it again

  Scenario: a superadmin grant reveals the workload console to one admin, and revoking it hides it
    Given "superadmin" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    # ── before any grant: the hidden tier is invisible to the admin ──
    When "admin-domain-a" navigates to "/admin"
    Then "admin-domain-a" sees the "admin-view" console
    And "admin-domain-a" does not see the "workloads" menu item
    # ── superadmin issues a live grant naming this admin ──
    When "superadmin" grants the workload console to "admin-domain-a" via the BFF
    # ── the grant flips the server-confirmed probe: the item AND the route appear ──
    When "admin-domain-a" navigates to "/admin"
    Then "admin-domain-a" sees the "workloads" menu item
    When "admin-domain-a" navigates to "/admin/workloads"
    Then "admin-domain-a" sees the "workload-console-view" console
    # ── superadmin revokes the grant ──
    When "superadmin" revokes that workload console grant via the BFF
    # ── the next navigation bounces to the admin landing (grant gone) and the item is gone ──
    When "admin-domain-a" navigates to "/admin/workloads"
    Then "admin-domain-a" is redirected to the admin landing page
    And "admin-domain-a" does not see the "workloads" menu item
