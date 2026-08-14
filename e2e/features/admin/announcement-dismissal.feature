# ANNOUNCEMENT DISMISSAL — the editor exposes a `dismissible` flag that no scenario
# exercised. This covers the leg THIS repo owns: authoring — the flag is persisted
# exactly as set (dismissible round-trips through create + re-read), for both a
# dismissible and a non-dismissible Home announcement.
#
# CROSS-REPO NOTE (deliberately NOT asserted here): the per-user suppression BEHAVIOUR
# — one user dismissing a Home banner not hiding it for another, and dismissible=false
# rendering with no dismiss control — is produced by the hugmesh.net HOST shell's
# announcement banner, not by this remote. It cannot be honestly proven in this
# repo-local harness; it belongs in a host-shell e2e that reads these authored rows.
#
# @cluster — real announcement writes need a live admin-bff + a Casdoor login.
@cluster @admin-ui @mutation
Feature: Announcement dismissal flag — authored and persisted exactly as set

  Scenario: the dismissible flag round-trips for both a dismissible and a non-dismissible announcement
    Given "superadmin" is logged in in their own context
    When "superadmin" creates an announcement titled "Dismissible notice" with dismissal allowed via the BFF
    Then the announcement titled "Dismissible notice" is stored with dismissal allowed
    When "superadmin" creates an announcement titled "Sticky notice" with dismissal disabled via the BFF
    Then the announcement titled "Sticky notice" is stored with dismissal disabled
