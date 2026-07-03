# FUNCTIONAL/WRITE coverage for the Egress-VPN console's cross-domain SUPERADMIN
# mutation (admin-ui wave 3). Unlike Superadmin Domains (which creates the domain
# ROW itself) and Device Licenses (whose per-device console rendering the admin-bff
# JSON shape does not actually populate — see console-coverage-steps.ts's own
# device-licenses honesty note), the Egress-VPN import form's "Brand domain (owner)"
# field is a plain, superadmin-typed target domain (EgressVpnController#importConfig,
# EgressVpnService#performImportConfig): the caller supplies ANY known residency
# brand — never their own scope — and the service stamps the imported config's
# `domain` from that typed value, not from the caller's PrincipalDomain. This is the
# real "superadmin edits/creates a row in a domain that isn't their own" write seam
# the wave asks for, and — unlike device-licenses — the console's `ev-configs` list
# renders straight off the config row the BFF returns (VpnConfigRow: id/domain/name/
# kind/state — no nested-DTO mismatch), so the ALLOW evidence is genuinely the same
# thing the operator sees.
#
# Honesty rules in force here:
#   - The ALLOW write is REAL: superadmin drives the actual console import form,
#     typing a target domain (domain-b) that is NOT their own (SUPERADMIN carries no
#     brand of its own — PrincipalDomain's "home" is unscoped), pastes a real,
#     parseable ProtonVPN WireGuard .conf (VpnConfigParser's own fixture text — a
#     malformed config 422s before ever reaching the domain check, so this is not a
#     shortcut around validation), and the assertion is the SAME evidence the
#     operator sees: the imported row appearing in the console's own configs list,
#     stamped with the domain that was TYPED, not any scope of the superadmin's.
#   - The DENY is a REAL POST with a bean-valid body (domain, name, config all valid)
#     -> 403 only, never shadowed by a 422/400. admin-domain-a genuinely holds
#     ROLE_ADMIN (not a no-role probe) and targets the SAME domain-b import — the
#     admin-bff's own javadoc is explicit that this mutation is
#     hasRole('SUPERADMIN') ONLY (an ADMIN may only ever READ, own-domain), so this
#     proves the write gate is superadmin-specific, not "any admin, any domain".
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @admin-ui @mutation
Feature: Egress-VPN console — superadmin cross-domain config import, admin denied

  Scenario: a superadmin imports a VPN config into a brand that isn't its own (ALLOW)
    Given "superadmin" is logged in
    When "superadmin" navigates to "/egress-vpn"
    Then "superadmin" sees the "egress-vpn-view" console
    When "superadmin" imports a VPN config for domain "domain-b" through the console
    Then "superadmin" sees the imported config for domain "domain-b" in the configs list

  # A domain admin genuinely holds ROLE_ADMIN — this is not a no-role probe — yet
  # EgressVpnController requires ROLE_SUPERADMIN specifically for every mutation
  # (the list is the only ADMIN-reachable method, and even that is own-domain-only),
  # so the import POST must still be rejected outright: 403 only, before the domain
  # residency check (or the config parse) ever runs.
  Scenario: a domain admin's cross-domain VPN-import POST is rejected outright — 403 only (DENY)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" POSTs to "/bff/admin/egress-vpn/configs" with body:
      """
      {"domain":"domain-b","name":"e2e-deny-probe","provider":"protonvpn","config":"[Interface]\nPrivateKey = aGVsbG8td29ybGQtcHJpdmF0ZS1rZXktYmFzZTY0AA==\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\nPublicKey = cGVlci1wdWJsaWMta2V5LWJhc2U2NC1oZXJlAAAAAAA=\nAllowedIPs = 0.0.0.0/0\nEndpoint = 185.159.157.1:51820\n"}
      """
    Then the response status is 403
