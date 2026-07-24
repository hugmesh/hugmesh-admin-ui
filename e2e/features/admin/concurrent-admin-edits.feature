# TWO SAME-DOMAIN ADMINS editing the same resource — every existing two-actor
# scenario is cross-domain or cross-role; none has two admins of the SAME domain
# mutating the same row. admin-domain-a and games-admin are both ROLE_ADMIN on
# domain-a (games-admin additionally carries games_services_admin), so they are the
# same-domain rivals. The announcements editor has no optimistic-locking UI, so the
# concrete risks are a ZOMBIE ROW (a save onto a row the rival already deleted) and a
# LAST-WRITE race (rival retitles) — both proven at the BFF seam.
#
# @cluster — real same-domain writes need a live admin-bff + two Casdoor logins.
@cluster @admin-ui @mutation
Feature: Two same-domain admins editing the same announcement concurrently

  # Leg 1 — delete-while-editing: a1 deletes the row a2 still holds; a2's save must
  # surface a server error (404, the row is gone), NOT silently recreate it, and both
  # admins' lists converge to the row's absence.
  Scenario: a save onto a row the rival deleted is refused, not silently recreated
    Given "admin-domain-a" is logged in in their own context
    And "games-admin" is logged in in their own context
    When "admin-domain-a" creates an announcement titled "Shared notice" via the BFF
    Then "admin-domain-a"'s announcements list contains "Shared notice"
    And "games-admin"'s announcements list contains "Shared notice"
    When "admin-domain-a" attempts to delete the announcement titled "Shared notice" via the BFF
    Then the response status is 200
    When "games-admin" attempts to update the announcement titled "Shared notice" via the BFF
    Then the response status is 404
    And "admin-domain-a"'s announcements list does not contain "Shared notice"
    And "games-admin"'s announcements list does not contain "Shared notice"

  # Leg 2 — rival retitles: two authorized same-domain updates race; the later write
  # wins and BOTH admins' tables converge to the same final title.
  Scenario: rival retitles converge on the last write for both admins
    Given "admin-domain-a" is logged in in their own context
    And "games-admin" is logged in in their own context
    When "admin-domain-a" creates an announcement titled "Rival notice" via the BFF
    When "games-admin" retitles the shared announcement "Rival notice" to "Renamed by a2" via the BFF
    When "admin-domain-a" retitles the shared announcement "Rival notice" to "Renamed by a1" via the BFF
    Then "admin-domain-a"'s announcements list contains "Renamed by a1"
    And "games-admin"'s announcements list contains "Renamed by a1"
    And "admin-domain-a"'s announcements list does not contain "Renamed by a2"
    And "games-admin"'s announcements list does not contain "Renamed by a2"
