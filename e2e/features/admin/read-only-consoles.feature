# OFFLINE-RENDERABLE coverage for the read-only + infra-gated admin consoles that
# have no local write seam of their own: Usage (`/usage`, usage-view), ISO downloads
# (`/isos`, iso-view), ArgoCD (`/argocd`, argocd-view) and the Backup & Recovery pair
# (`/backup`, backup-view; `/recovery`, recovery-view). The route-MATRIX already proves
# the guard ALLOW on each; this proves each console renders its HONEST state with NO
# backend — the behaviour the components own client-side:
#   - Usage: usage() is null with no BFF, so the template renders its DEFAULT figures
#     (0 / 0) + both breakdown tables — a real render, not a spinner or an error.
#   - ISO downloads: an empty list renders the explicit "No ISO builds delivered yet"
#     empty state (mutually exclusive with any download row).
#   - ArgoCD + Backup: PlatformCapabilitiesService's fail-safe absent envelope drives
#     the capability-gate (role=status degraded banner) and SUPPRESSES the console's
#     action surface (the app grid / the backup form) — graceful degradation, never a
#     503/error. The gate carries data-capability so the correct infra is named.
#   - Recovery: with no restorable backups, the empty state renders and the restore
#     form is not shown.
#
# All @offline — runs against `ng serve admin` (the dev shell mounts ADMIN_ROUTES at the
# root) with no backend; every assertion is a real observable state that fails against a
# blank page. Live-data reads (real usage figures, a real ISO list, a live ArgoCD app
# grid, a real backup/restore run) belong to the live stack and are out of this batch's
# scope (they need seeded ClickHouse / CI artifacts / ArgoCD / Velero respectively).

@admin-ui @read-only
Feature: Read-only & infra-gated consoles — honest offline render, empty + degraded states

  @offline
  Scenario: the Usage dashboard renders default figures with no backend
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/usage"
    Then "admin-domain-a" sees the "usage-view" console
    And "admin-domain-a" sees the usage dashboard with default figures

  @offline
  Scenario: the ISO downloads console shows its empty state with no backend
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/isos"
    Then "admin-domain-a" sees the "iso-view" console
    And "admin-domain-a" sees the ISO downloads empty state

  @offline
  Scenario: the ArgoCD console degrades behind the capability gate when ArgoCD is absent
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/argocd"
    Then "admin-domain-a" sees the "argocd-view" console
    And "admin-domain-a" sees the "argocd" capability-gate notice
    And the "argocd-app-grid" action is not rendered for "admin-domain-a"

  @offline
  Scenario: the Backup console degrades behind the capability gate when Velero is absent
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/backup"
    Then "admin-domain-a" sees the "backup-view" console
    And "admin-domain-a" sees the "velero" capability-gate notice
    And the "backup-start" action is not rendered for "admin-domain-a"

  @offline
  Scenario: the Recovery console shows its empty state with no restorable backups
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/recovery"
    Then "admin-domain-a" sees the "recovery-view" console
    And "admin-domain-a" sees the recovery empty state
