# EVERY-FUNCTION coverage for the Desktop-governance console (admin.routes.ts
# `/desktop` → DesktopGovernanceComponent, desktop-governance-view) and the
# admin-bff endpoints behind its SSH-terminal / desktop-sudo / remote-install
# legs — hugmesh-admin-bff-api origin/main 6dc72d1: DesktopSshTerminalController
# (POST /bff/admin/desktop/ssh-terminal/sessions), DesktopSudoAdminController
# (GET /bff/admin/desktop/sudo, POST …/sudo/grant, DELETE …/sudo/{grantId}),
# DesktopStepUpController (POST /bff/admin/desktop/step-up) and
# DesktopRemoteInstallController (POST /bff/admin/desktop/remote-install), every
# method @PreAuthorize("hasAnyRole('ADMIN','SUPERADMIN')"), hardened by
# admin-bff PR "harden the real SSH dial before any default-on" (7732f087,
# 2026-09-10). Neither lane dials a device: a real sudo/terminal dial spawns
# launchers that can wedge the host, so the ALLOW rows stop at the list /
# step-up / descriptor layers.
#
# Two lanes:
#   - @offline — the console's client-side gate state, reachable with no backend
#     against `ng serve admin` (adminGuard is a pure session check, so a seeded
#     session passes). The HIDDEN-tier "SSH dials" tab is absent for a domain
#     admin (dialTabVisible() = superadmin AND a CONFIRMED dial capability, so a
#     superadmin whose probe cannot be answered is fail-closed too), and with no
#     device to pick the terminal's "open terminal" and the sudo "grant sudo"
#     controls are [disabled] with a role=status gate help that says why — real
#     states that fail against a blank page.
#   - @cluster — the BFF role matrix at the front door, real logins:
#       GET  /bff/admin/desktop/sudo          admin/superadmin 200 (a list needs no
#                                             licence); mod/plain 403; anonymous 401.
#       POST /bff/admin/desktop/step-up       the role gate stands in front of a
#                                             DARK mint: mod/plain 403, while an
#                                             admin reaches the mint and gets the
#                                             documented 503 ("ships dark", no token)
#                                             until app.device-terminal.enabled=true.
#       POST /bff/admin/desktop/remote-install the A5 unified step-up gate runs FIRST
#                                             and fail-closed: an admin/superadmin is
#                                             refused 403 CARRYING
#                                             X-Step-Up-Required: X-Device-Terminal-StepUp
#                                             (StepUpRequiredException.forRetryHeader),
#                                             where a mod or plain user gets the bare
#                                             role 403 with NO signal — the one
#                                             distinguishing ALLOW-side outcome.
#     NOT pinned: an ALLOW on ssh-terminal/sessions or sudo/grant — every
#     device-targeting denial there is deliberately the SAME generic 403 as a role
#     denial (anti-enumeration), and a real ALLOW needs a registered device plus an
#     active device-ssh-license: a person on a live mesh with a device.

@admin-ui @desktop-governance
Feature: Desktop governance — hidden dial tier, gated terminal and sudo, and the BFF role matrix behind them

  # ── @offline: client-side gate state, no backend ─────────────────────────────

  @offline
  Scenario: a domain admin reaches the console and never sees the superadmin-only SSH-dials tab
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/desktop"
    Then "admin-domain-a" sees the "desktop-governance-view" console
    And "admin-domain-a" sees the "dg-tab-terminal" desktop tab
    And "admin-domain-a" sees no "dg-tab-dials" desktop tab

  # The probe (bff.service.ts desktopDialCapability) is answered DARK here on purpose:
  # an unmocked probe under `ng serve` hits the dev server's SPA fallback, which
  # answers 200 text/html — and the probe trusts any `r.ok`, so the tab APPEARS
  # (measured 2026-09-23; filed as a defect, see the PR). 503 is what admin-bff sends
  # while the dial leg ships dark, so this row pins the real fail-closed answer.
  @offline
  Scenario: a superadmin whose dial leg answers dark sees no SSH-dials tab either (fail-closed)
    Given "superadmin" has a seeded session
    And the desktop dial-capability probe answers dark for "superadmin"
    When "superadmin" navigates to "/desktop"
    Then "superadmin" sees the "desktop-governance-view" console
    And "superadmin" sees the "dg-tab-sudo" desktop tab
    And "superadmin" sees no "dg-tab-dials" desktop tab

  @offline
  Scenario: with no device to pick, the SSH terminal cannot be opened and the gate help says why
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/desktop"
    And "admin-domain-a" opens the "dg-tab-terminal" desktop tab
    Then "admin-domain-a" sees the "desktop-ssh-terminal-view" console
    And the "dst-open" desktop control is disabled for "admin-domain-a" with the gate help "dst-gate-help" saying "Pick a device to open an SSH terminal on."

  @offline
  Scenario: with no device to pick, desktop sudo cannot be granted and the gate help says why
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/desktop"
    And "admin-domain-a" opens the "dg-tab-sudo" desktop tab
    Then "admin-domain-a" sees the "desktop-sudo-view" console
    And the "ds-grant" desktop control is disabled for "admin-domain-a" with the gate help "ds-gate-help" saying "Pick a device to grant sudo on."

  # ── @cluster: GET /bff/admin/desktop/sudo — the list any ADMIN/SUPERADMIN reads ──

  @cluster
  Scenario: a domain admin lists desktop sudo grants (ALLOW) — 200
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/admin/desktop/sudo"
    Then the response status is 200

  @cluster
  Scenario: a superadmin lists desktop sudo grants (ALLOW) — 200
    Given "superadmin" is logged in
    When "superadmin" GETs "/bff/admin/desktop/sudo"
    Then the response status is 200

  @cluster
  Scenario: a mod reading desktop sudo grants is forbidden (sibling, not subset) — 403
    Given "mod-user" is logged in
    When "mod-user" GETs "/bff/admin/desktop/sudo"
    Then the response status is 403

  @cluster
  Scenario: a plain user reading desktop sudo grants is forbidden — 403
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/admin/desktop/sudo"
    Then the response status is 403

  @cluster
  Scenario: an unauthenticated read of desktop sudo grants is rejected — 401
    Given a clean session
    When the unauthenticated client GETs "/bff/admin/desktop/sudo"
    Then the response status is 401

  # ── @cluster: POST /bff/admin/desktop/step-up — role gate in front of a dark mint ──

  @cluster
  Scenario: a mod cannot mint a desktop step-up — 403
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/desktop/step-up" with body:
      """
      {}
      """
    Then the response status is 403

  @cluster
  Scenario: a plain user cannot mint a desktop step-up — 403
    Given "plain-user" is logged in
    When "plain-user" POSTs to "/bff/admin/desktop/step-up" with body:
      """
      {}
      """
    Then the response status is 403

  # The mint 503s while app.device-terminal.enabled=false (the default): the role
  # gate passed, "authorization is live, no token was minted". Flip that flag on a
  # mesh and this row becomes 200 or a licence 403 — re-pin it then, not before.
  @cluster
  Scenario: a domain admin reaches the desktop step-up mint, which ships dark — 503
    Given "admin-domain-a" is logged in
    When "admin-domain-a" POSTs to "/bff/admin/desktop/step-up" with body:
      """
      {}
      """
    Then the response status is 503

  # ── @cluster: POST /bff/admin/desktop/remote-install — the step-up SIGNAL is the
  #    ALLOW-side tell. Bean-valid body (deviceId ≤36, appRef in the Flatpak/OCI
  #    charset) so a 400 can never shadow the verdict; the probe device is never
  #    registered, and the step-up gate refuses before any device check runs. ──

  @cluster
  Scenario: a domain admin's remote-install is refused with the device-terminal step-up signal
    Given "admin-domain-a" is logged in
    When "admin-domain-a" POSTs to "/bff/admin/desktop/remote-install" capturing the step-up signal with body:
      """
      {"deviceId":"e2e-deny-probe","appRef":"org.example.E2eProbe"}
      """
    Then the captured response was a 403 carrying the step-up signal "X-Device-Terminal-StepUp"

  @cluster
  Scenario: a superadmin's remote-install is refused with the same step-up signal
    Given "superadmin" is logged in
    When "superadmin" POSTs to "/bff/admin/desktop/remote-install" capturing the step-up signal with body:
      """
      {"deviceId":"e2e-deny-probe","appRef":"org.example.E2eProbe"}
      """
    Then the captured response was a 403 carrying the step-up signal "X-Device-Terminal-StepUp"

  @cluster
  Scenario: a mod's remote-install is a bare role refusal that carries no step-up signal
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/desktop/remote-install" capturing the step-up signal with body:
      """
      {"deviceId":"e2e-deny-probe","appRef":"org.example.E2eProbe"}
      """
    Then the captured response was a 403 without any step-up signal

  @cluster
  Scenario: a plain user's remote-install is a bare role refusal that carries no step-up signal
    Given "plain-user" is logged in
    When "plain-user" POSTs to "/bff/admin/desktop/remote-install" capturing the step-up signal with body:
      """
      {"deviceId":"e2e-deny-probe","appRef":"org.example.E2eProbe"}
      """
    Then the captured response was a 403 without any step-up signal

  # ── @cluster: the other two write verbs, DENY rows only (see the header) ──

  @cluster
  Scenario: a mod cannot open an in-UI SSH terminal session — 403
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/desktop/ssh-terminal/sessions?deviceId=e2e-deny-probe" with body:
      """
      {}
      """
    Then the response status is 403

  @cluster
  Scenario: a plain user cannot open an in-UI SSH terminal session — 403
    Given "plain-user" is logged in
    When "plain-user" POSTs to "/bff/admin/desktop/ssh-terminal/sessions?deviceId=e2e-deny-probe" with body:
      """
      {}
      """
    Then the response status is 403

  @cluster
  Scenario: a mod cannot grant desktop sudo — 403
    Given "mod-user" is logged in
    When "mod-user" POSTs to "/bff/admin/desktop/sudo/grant" with body:
      """
      {"subject":"google:plain-user@example.test","deviceId":"e2e-deny-probe"}
      """
    Then the response status is 403

  @cluster
  Scenario: a plain user cannot revoke a desktop sudo grant — 403
    Given "plain-user" is logged in
    When "plain-user" DELETEs "/bff/admin/desktop/sudo/e2e-deny-probe"
    Then the response status is 403
