# PHONE-WIDTH LAYOUT (GUI-30): at 390x844 three admin routes scrolled sideways. The
# routed view was wider than the phone, so documentElement.scrollWidth exceeded its
# clientWidth: /admin/backing-services by 33px (its 7-column table), /admin/docs by
# 43px (the api-docs navigator stayed beside the detail pane, which wrapped one
# character per line) and /admin/domain-capabilities by 2px (the capability select is
# as wide as its longest option).
#
# @cluster only. The overflow comes from the HOST SHELL's sizing of a routed view (its
# backpane shrinks a view to fit its content, so a wide table becomes a wide page) and
# from the live catalog's rows. The standalone dev shell (`ng serve admin`) has neither:
# its <main> is a plain block and the offline consoles render without rows, so an
# @offline copy of these scenarios passes on the unfixed code and would prove nothing.
# /admin/docs is the hugmesh-api-docs remote, reachable only through the host shell.
# The CI gate for the same layouts is the karma spec src/app/phone-width.spec.ts (and
# docs-shell.phone-width.spec.ts in hugmesh-api-docs), which reproduces both the phone
# viewport and the shell's sizing.

@admin-ui @phone-width @cluster
Feature: Admin consoles fit a 390x844 phone without horizontal scrolling

  Scenario Outline: <console> fits a 390px phone inside the host shell
    Given "superadmin" is logged in
    And "superadmin" uses a 390x844 viewport
    When "superadmin" navigates to "<path>"
    Then "superadmin" sees the "<view>" console
    And "superadmin" sees no horizontal overflow

    Examples:
      | console             | path                       | view                     |
      | Backing services    | /admin/backing-services    | backing-services-view    |
      | Domain capabilities | /admin/domain-capabilities | domain-capabilities-view |

  Scenario: the API docs fit a 390px phone inside the host shell, navigator above the pane
    Given "superadmin" is logged in
    And "superadmin" uses a 390x844 viewport
    When "superadmin" navigates to "/admin/docs"
    Then "superadmin" sees the API docs navigator above its detail pane
    And "superadmin" sees no horizontal overflow
