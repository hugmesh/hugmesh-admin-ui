# FUNCTIONAL/WRITE coverage for the Gateway-access rule editor (admin.routes.ts
# `/route-access` → RouteAccessComponent, route-access-view). Distinct from the
# per-role route-MATRIX (route-matrix.feature), which only asserts the guard ALLOW/
# bounce on the surface — this covers the console's actual WRITE seam: AdminController's
# POST/DELETE /bff/admin/route-access, which upserts/removes a gateway_route_access rule
# (per-gateway role→URL allow/deny), ROLE_ADMIN-only.
#
# Two lanes:
#   - @offline — the console's PURE CLIENT-SIDE validation: RouteAccessComponent.add()
#     short-circuits with a role=alert formError BEFORE any BFF call when the URL pattern
#     is blank. Runs against `ng serve admin` (the dev shell mounts ADMIN_ROUTES at the
#     root) with no backend; the assertion is a real state change (the alert appears, the
#     field flips aria-invalid, and no rule is persisted) that fails against a blank page.
#   - @cluster — the REAL add + remove write against the live admin-bff, proven in the SAME
#     table the operator reads (the row rendered from the server's response carries the
#     server-issued data-rule-id), plus the role DENY: a mod's POST dies at the admin-bff
#     URL gate (/bff/admin/** requires ROLE_ADMIN|ROLE_SUPERADMIN) with a bean-valid body,
#     so a 400 can never shadow the 403.

@admin-ui @route-access
Feature: Gateway-access rule editor — client-side validation, real add/remove, admin-only

  @offline
  Scenario: submitting a blank URL pattern is blocked client-side with no write (validation)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/route-access"
    Then "admin-domain-a" sees the "route-access-view" console
    When "admin-domain-a" submits the gateway-access form with a blank URL pattern
    Then "admin-domain-a" sees the gateway-access validation error

  @cluster
  Scenario: an admin adds then removes a real gateway-access rule through the console (ALLOW)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" navigates to "/route-access"
    Then "admin-domain-a" sees the "route-access-view" console
    When "admin-domain-a" adds a gateway-access rule through the console
    Then the gateway-access rule appears in "admin-domain-a"'s rules table
    When "admin-domain-a" removes that gateway-access rule
    Then the gateway-access rule no longer appears in "admin-domain-a"'s rules table

  # A mod carries real moderation power but not ROLE_ADMIN — the admin-bff URL gate
  # rejects the write outright, before the body is ever persisted. Bean-valid body so
  # the 403 is the authz verdict, never a validation 400.
  @cluster
  Scenario: a mod's add-rule POST is rejected outright — 403 only (DENY)
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/route-access" with body:
      """
      {"gateway":"hugmesh-be-gateway","url_pattern":"/api/e2e-deny-probe/**","role":"ROLE_ADMIN","allow":true}
      """
    Then the response status is 403
