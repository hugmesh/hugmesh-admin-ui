# DEVICE RADIOS console (/admin/device-radios → DeviceRadiosComponent,
# device-radios-view) — attach/detach Meshtastic LoRa radios to mesh nodes over USB
# serial, LoRa-WiFi TCP, or MQTT WAN mesh. Had ZERO e2e. ADMIN-capable (not
# superadmin), so the BFF is the real gate.
#
# Two lanes:
#   - @offline — the per-transport form shape (the picker shows EXACTLY the selected
#     transport's required fields; a mixed shape is a BFF 422) and the client-side
#     blank-submit validation (a role=alert before any write). Runs on `ng serve admin`.
#   - @cluster — the URL-gate DENY: a mod (a SIBLING role, not ADMIN) cannot attach a
#     radio; the bean-valid body means the 403 is the authz verdict, never a 400.

@admin-ui @device-radios
Feature: Device radios — per-transport form shape, client validation, and the admin-only write gate

  @offline
  Scenario: the transport picker shows exactly the selected transport's fields, and a blank attach is blocked
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/device-radios"
    Then "admin-domain-a" sees the "device-radios-view" console
    And "admin-domain-a" sees only the "serial" radio transport fields
    When "admin-domain-a" selects the "tcp" radio transport
    Then "admin-domain-a" sees only the "tcp" radio transport fields
    When "admin-domain-a" selects the "mqtt" radio transport
    Then "admin-domain-a" sees only the "mqtt" radio transport fields
    When "admin-domain-a" submits the radio attach form with no fields filled
    Then "admin-domain-a" sees the radio attach validation error

  # A mod carries real moderation power but not ROLE_ADMIN — /bff/admin/** rejects the
  # attach outright, before the body is ever persisted. The USB-serial body is bean-valid
  # so the 403 can only be the authz verdict, never a validation 400.
  @cluster
  Scenario: a mod's radio-attach POST is rejected outright — 403 only (DENY)
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/device-radios/e2e-node/radios" with body:
      """
      {"transport":"serial","serialPath":"/dev/ttyUSB0","radioId":"lora-0","meshChannel":0}
      """
    Then the response status is 403
