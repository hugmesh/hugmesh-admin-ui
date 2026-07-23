# DOMAIN-CAPABILITY GATE — the platform's three-actor authorization chain
# (/admin/domain-capabilities → DomainCapabilitiesComponent, domain-capabilities-view;
# admin-bff DomainCapabilityAdminController). A user may register a mesh radio under
# their own name only once a SUPERADMIN has GRANTED `user-mesh-devices` to their domain
# AND that domain's ADMIN has ENABLED it, with a platform-wide kill switch on the
# ' global' sentinel row. This whole chain had ZERO e2e.
#
# Two lanes:
#   - @offline — the admin own-domain card's HONEST no-backend state: with the capability
#     never granted (the BFF read rejects offline → no own row), the enable toggle is
#     disabled and the "ask a superadmin to grant it first" hint renders. A real disabled
#     control + hint that fails against a blank page (runs on `ng serve admin`).
#   - @cluster — the full three-actor loop against the live admin-bff, plus the two
#     documented 403 DENYs (bff.service.ts:1139-1143): a domain-B admin cannot ENABLE
#     domain-A's capability (own-domain only), and no ADMIN can GRANT at all (SUPERADMIN
#     only). Exact 403, never an OR.

@admin-ui @domain-capabilities
Feature: Domain-capability gate — superadmin grants, domain admin enables, other domain excluded

  @offline
  Scenario: an ungranted domain admin sees the enable toggle disabled with the ask-a-superadmin hint (offline)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/domain-capabilities"
    Then "admin-domain-a" sees the "domain-capabilities-view" console
    And "admin-domain-a" sees their own domain is not yet granted the capability

  @cluster
  Scenario: the full grant -> enable chain, and neither the wrong domain nor the wrong role can act
    Given "superadmin" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "superadmin" navigates to "/admin/domain-capabilities"
    Then "superadmin" sees the "domain-capabilities-view" console
    When "admin-domain-a" navigates to "/admin/domain-capabilities"
    Then "admin-domain-a" sees the "domain-capabilities-view" console
    And "admin-domain-a" sees their own domain is not yet granted the capability
    # ── SUPERADMIN grants domain-a (the first key) ──
    When "superadmin" grants the mesh-devices capability to domain "domain-a" through the console
    Then "superadmin" sees domain "domain-a" granted in the capabilities table
    # ── the grant is visible to domain-a's admin, who supplies the SECOND key ──
    When "admin-domain-a" navigates to "/admin/domain-capabilities"
    Then "admin-domain-a" sees their own domain is now granted the capability
    When "admin-domain-a" enables the capability for their own domain
    Then "admin-domain-a" sees the capability enabled for their own domain
    # ── domain-B's admin cannot ENABLE domain-A's capability (own-domain only → 403) ──
    When "admin-domain-b" attempts to enable the capability for domain "domain-a" via the BFF
    Then the response status is 403
    # ── no ADMIN may GRANT at all — that key is SUPERADMIN-only (→ 403) ──
    When "admin-domain-b" attempts to grant the capability to domain "domain-a" via the BFF
    Then the response status is 403
    # ── the platform-wide kill switch is the superadmin's global override ──
    When "superadmin" turns the platform-wide kill switch off through the console
    Then "superadmin" sees the platform-wide kill switch off
