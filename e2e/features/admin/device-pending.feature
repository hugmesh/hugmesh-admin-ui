# FUNCTIONAL coverage for the Pending-devices pick-list (admin.routes.ts
# `/device-pending` → DevicePendingComponent, device-pending-view). SUPERADMIN-only
# (superadminGuard): a superadmin picks a headscale-enrolled-but-unregistered node and
# assigns its residency (owner type / domain / physical owner / mesh). The machine-key
# fingerprint is an OPAQUE token — displayed read-only, NEVER a typed/edited input.
#
# Two lanes:
#   - @offline — the console's client-side pick-list state, reachable with no backend and
#     as a real SUPERADMIN (superadminGuard is a pure client-side session check, so it
#     passes with a seeded superadmin session against `ng serve admin`). With no enrolled
#     node the register control is [disabled]="!selectedFp" and the read-only opaque
#     fingerprint shows its "—" placeholder — a real state that fails against a blank page.
#   - @cluster — the role DENY: a plain domain ADMIN (genuinely ROLE_ADMIN, not a no-role
#     probe) POSTs the register endpoint with a bean-valid body and is still rejected —
#     the registry is SUPERADMIN-only, so the guard gates on the SPECIFIC role, not "any
#     admin" → 403. (The register ALLOW needs a LIVE headscale control node to surface an
#     enrolled-but-unregistered candidate — the fingerprint is auto-captured from
#     headscale, never fabricated — so, per DevicePendingComponent's own "ships dark"
#     advisory, the real register write stays a live-stack concern.)

@admin-ui @device-pending
Feature: Pending-devices pick-list — disabled register with no candidate, superadmin-only

  @offline
  Scenario: with no enrolled node the register control is disabled (superadmin, no backend)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/device-pending"
    Then "superadmin" sees the "device-pending-view" console
    And "superadmin" sees the register control disabled with no assignable node

  # A domain admin holds ROLE_ADMIN but not ROLE_SUPERADMIN — the register endpoint is
  # superadmin-only, so the POST is rejected. Bean-valid body so the 403 is the authz
  # verdict, never a validation 400.
  @cluster
  Scenario: a domain admin's register-from-pending POST is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" POSTs to "/bff/admin/device-licenses/register" with body:
      """
      {"machineKeyFp":"e2e-deny-probe-fp","hostname":"e2e-deny-probe","ownerType":"ADMIN","imageType":"mesh-extension","physicalOwner":"e2e@example.test","domain":"domain-a","meshId":"e2e-mesh"}
      """
    Then the response status is 403
