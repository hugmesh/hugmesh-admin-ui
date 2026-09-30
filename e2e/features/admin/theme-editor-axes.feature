# The domain theme editor ("the theme maker": admin.routes.ts `/themes` →
# DomainThemesComponent) and the axes an operator can pick in it.
#
# hugmesh-host-shell#19 box 2 asks for "other vanta.js effect options selectable in
# the theme maker". The shell half is landed (host-shell PR #25: a theme-declared
# Vanta effect layer, `--sd-bg-effect`; login-ui grew the effect catalogue in its
# PR #6), but the issue's 2026-09-05 comment records the open half precisely:
# "effects are not yet *selectable in the theme maker*: admin-ui's domain-themes
# editor offers ramps/styles/decors only, no effect axis". Re-checked on admin-ui
# origin/main d5ffdf8 (2026-09-23): RAMPS, STYLES and DECORS in
# themes/domain-themes.service.ts, and no effect control in the template.
#
# So this file carries one LIVE row (the three axes the editor really offers, so the
# file is never all-@fixme and the mock is proven to open the editor) and one
# `@fixme @issue:host-shell-19` row asserting the CORRECT behaviour: an effect
# choice with more than one effect. It is located by its accessible label, not a
# guessed testid, so it turns green unmodified whatever the control's testid ends up
# being. The other open half of box 4 (a header-scale hook in the generator's
# login-preview demo) lives in hugmesh-generator, outside this suite.
#
# @offline: GET /bff/admin/themes is answered by page.route() with one domain row,
# so no backend is needed (`ng serve admin` + E2E_BASE_URL, see e2e/README.md).
@admin-ui @domain-themes
Feature: Domain theme editor — the axes an operator can pick

  @offline
  Scenario: a superadmin editing a domain's theme can pick its ramp, style and nav decoration
    Given "superadmin" has a seeded session
    And the admin-bff lists one themed domain "domain-a.example" to "superadmin"
    When "superadmin" navigates to "/themes"
    And "superadmin" opens the theme editor for "domain-a.example"
    Then the theme editor offers the "field-ramp" choice including "dawn"
    And the theme editor offers the "field-style" choice including "glass"
    And the theme editor offers the "field-decor" choice including "sparkle"

  @offline @fixme @issue:host-shell-19
  Scenario: the theme editor offers a selectable background effect axis
    Given "superadmin" has a seeded session
    And the admin-bff lists one themed domain "domain-a.example" to "superadmin"
    When "superadmin" navigates to "/themes"
    And "superadmin" opens the theme editor for "domain-a.example"
    Then the theme editor offers a background effect choice with more than one effect
