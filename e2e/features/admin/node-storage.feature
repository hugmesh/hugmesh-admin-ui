# FUNCTIONAL/WRITE coverage for the Node-storage console (admin.routes.ts
# `/node-storage` → StoragePoolsComponent, storage-pools-view). ADMIN-CAPABLE
# (adminGuard, NOT superadmin); the BFF ownership-gates the writes (an admin may act
# only on own-domain ADMIN-owned nodes). Two write seams: attach a pool to a node
# (POST /bff/admin/device-storage-pools/{deviceId}/pools) and assign a service to a
# pool (POST …/pools/{poolId}/assignments).
#
# Two lanes:
#   - @offline — the console's CLIENT-SIDE safety surface, reachable with no backend:
#       * the node-pinned no-HA WARNING — assignWarning() is a pure client-side heuristic
#         re-run on every ngModel change; a database-shaped service name surfaces a
#         role=status advisory (node-pinned storage has no HA → data-loss risk).
#       * the attach-pool form's inline validation — attach() short-circuits with a
#         role=alert error BEFORE any BFF call when the disk serial / path are blank.
#     Both are real state changes that fail against a blank page.
#   - @cluster — the role DENY: a mod's attach POST dies at the admin-bff URL gate
#     (/bff/admin/** requires ROLE_ADMIN|ROLE_SUPERADMIN) with a bean-valid body → 403
#     only. (The attach/assign ALLOW writes need a pre-seeded own-domain registered
#     DEVICE to attach to — the sp-device picker is populated from the device-license
#     registry — so the real create-write is left to the device-registry seed wave; the
#     mod DENY proves the BFF gate honestly today.)

@admin-ui @node-storage
Feature: Node-storage console — client-side no-HA warning + attach validation, admin-only writes

  @offline
  Scenario: a database-shaped service name surfaces the node-pinned no-HA warning (client-side)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/node-storage"
    Then "admin-domain-a" sees the "storage-pools-view" console
    When "admin-domain-a" enters a database-shaped service name in the assign form
    Then "admin-domain-a" sees the node-pinned no-HA storage warning

  @offline
  Scenario: the attach-pool form blocks a blank submit client-side with no write (validation)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/node-storage"
    Then "admin-domain-a" sees the "storage-pools-view" console
    When "admin-domain-a" submits the attach-pool form with blank fields
    Then "admin-domain-a" sees the attach-pool validation error

  # A mod holds no admin role — the admin-bff URL gate rejects the storage write outright.
  # Bean-valid body so the 403 is the authz verdict, never a validation 400.
  @cluster
  Scenario: a mod's attach-pool POST is rejected outright — 403 only (DENY)
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/device-storage-pools/e2e-deny-probe-device/pools" with body:
      """
      {"diskSerial":"E2E-DENY-PROBE","poolPath":"/var/snapdragon/storage/e2e","reservedBytes":107374182400,"exclusive":false,"filesystem":"ext4"}
      """
    Then the response status is 403
