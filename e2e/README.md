# hugmesh-admin-ui — e2e (Playwright + playwright-bdd)

Gherkin-driven end-to-end harness for the admin-ui federated remote, copied from
the proven `hugmesh-games/e2e` pattern: `@playwright/test` and `playwright-bdd`,
one worker running serially, `screenshot:'on'` and `video:'on'`, an HTML reporter,
and the per-step PNG `AfterStep` hook in `features/support/fixtures.ts`.

The admin-ui is the **multi-tenant authorization keystone**, so the suite starts
with the deepest cross-user and DENY coverage:

| Class | Feature file | What it asserts |
| --- | --- | --- |
| USER-SITUATIONAL | `features/admin/admin-surfaces.feature` | each admin / superadmin console, guard ALLOW + DENY |
| USER-SITUATIONAL | `features/admin/games-services-gating.feature` | runner sees the console but create is **disabled + `gs-runner-help`** helptext; admin's create is enabled |
| USER-SITUATIONAL | `features/admin/route-matrix.feature` | table-driven per-role route matrix: every `admin.routes.ts` route × {superadmin, admin, **mod**, plain user, **signed-out**}, outcomes derived from the actual guards |
| MUTATION | `features/admin/mutations.feature` | REAL writes: superadmin creates+updates an announcement via the UI; games-admin creates an instance; runner / cross-domain admin POSTs → 403; victim-creates-first cross-tenant PUT/DELETE → 404 (invisible-by-design) with the victim's row untouched |
| MULTIUSER | `features/multitenant/domain-admin.feature` | a domain admin operating over their **own** domain |
| CROSS-USER | `features/multitenant/cross-domain-isolation.feature` | domain-A admin DENIED on domain-B; admin DENIED on superadmin-only; anonymous → 401; superadmin reads BOTH brands where each admin sees only its own (the DomainScope null predicate) |
| SECURITY | `features/security/bff-auth-gates.feature` | the admin-bff rejection paths behind the display-only consoles, incl. the mod sibling-not-superset 403s and a REAL runner create-POST → 403 |
| A11Y | `features/a11y/accessibility.feature` | skip-link → focus `#main`, named landmarks, roving tabindex, capability-gate `role="status"`, focus restore |
| EVERY-FUNCTION | `features/admin/route-access-edit.feature` | Gateway-access rule editor: `@offline` client-side blank-pattern validation (role=alert + `aria-invalid`, no write); `@cluster` real add+remove (row rendered from the server response, `data-rule-id`) and a mod add-POST → 403 |
| EVERY-FUNCTION | `features/admin/node-storage.feature` | Node-storage console: `@offline` the node-pinned **no-HA warning** heuristic on a database-shaped service name, and attach-form blank-submit validation; `@cluster` a mod attach-POST → 403 |
| EVERY-FUNCTION | `features/admin/read-only-consoles.feature` | `@offline` honest no-backend states of the read-only / infra-gated consoles: Usage default figures, ISO empty state, ArgoCD + Backup **capability-gate degradation** (action surface suppressed), Recovery empty state |
| EVERY-FUNCTION | `features/admin/device-pending.feature` | Pending-devices pick-list: `@offline` register control **disabled** with no candidate + opaque-fp placeholder (superadmin); `@cluster` a domain-admin register-POST → 403 (superadmin-only) |
| MUTATION | `features/admin/egress-vpn-cross-domain.feature` | Egress-VPN console: superadmin imports a VPN config into a brand that is **not its own** (real cross-domain write, UI evidence) and a domain admin's identical POST → 403 (SUPERADMIN-only, not "any admin") |
| MUTATION | `features/admin/account-appeals-decide.feature` | Account-ban Appeals console (admin-ui #65): ADMIN approve **actually restores** the appellant's access (re-read via the BFF, not assumed from the 200), ADMIN deny leaves it restricted, SUPERADMIN decides **cross-domain**, and a mod's decide attempt is a real 403 (not merely UI-hidden) |
| USER-SITUATIONAL | `features/admin/phone-fleet.feature` | Superadmin Phone-fleet console (sovereign MDM registry): guard ALLOW/DENY, menu visibility, BFF role gate, list-read honesty — no write seam here (enrolment/profile management is device-side) |
| MUTATION | `features/admin/phone-management.feature` | Extends phone-fleet with the WRITE seam: superadmin sets the authoritative management mode (managed/BYOD) and locks/unlocks a managed device, SUPERADMIN-only + step-up gated |
| MULTIUSER | `features/admin/my-fleet.feature` | Fleet-owner "My fleet" console — a non-superadmin FLEET_ADMIN/ADMIN reaches ONLY their own phones (`fleetAdminGuard` ALLOW/DENY), the tenancy-walled twin of the superadmin console |
| MUTATION | `features/admin/fleet-provisioning.feature` | SUPERADMIN-only: owner assignment (the tenancy wall for My fleet) on the phone-fleet console, and the Fleet-entitlements grant/revoke console — both step-up gated |
| MULTIUSER | `features/admin/domain-capabilities.feature` | the three-actor CAPABILITY GATE: superadmin **grants** a domain, that domain's admin **enables** it, a domain-B admin's enable of domain-A → 403, no admin may grant (superadmin-only) → 403, and the platform-wide kill switch; `@offline` the ungranted admin's disabled toggle + hint |
| MULTIUSER | `features/admin/workload-hidden-tier.feature` | the HIDDEN menu tier's causal loop: a superadmin **grant** reveals the workload menu item + route to one admin mid-session; a **revoke** bounces the route back to `/admin` and the item disappears |
| MULTIUSER | `features/admin/mfa-security.feature` | cross-user MFA factor **isolation** (one admin's enrolled factor invisible to another), the honest **dark** state, and the step-up-gated remove + regenerate **journey** through the shared dialog with a real RFC-6238 code |
| MULTIUSER | `features/admin/role-revoke-mid-session.feature` | a **live** ROLE_ADMIN session works, a superadmin revokes it, and the SAME session's next admin read is cut off (revoked custody JWT); re-grant restores the seed |
| MUTATION | `features/admin/concurrent-admin-edits.feature` | two **same-domain** admins on one announcement: a save onto a rival-deleted row is refused (404, not a silent recreate); rival retitles converge on the last write for both |
| MUTATION | `features/admin/ssh-key-issuance.feature` | SSH credential mint: the ships-**dark** panel state, a domain admin's issue POST → 403 (superadmin-only), and the enabled-feature mint → step-up → **one-time** download journey |
| EVERY-FUNCTION | `features/admin/device-radios.feature` | `@offline` the per-transport form shape (serial/tcp/mqtt fields) + blank-attach validation; `@cluster` a mod attach POST → 403 |
| MUTATION | `features/admin/access-suspension.feature` | Delegation console: an admin bans then lifts a user's PROFILE access role (the ban and restore lever); a mod's suspend POST → 403; a domain-B admin cannot see domain-A's ban |
| MUTATION | `features/admin/allowlist-invite.feature` | an admin invites a Gmail and a Discord identity through the console; the write is the durable allowlist row the login-ui registration gate reads |
| MUTATION | `features/admin/announcement-dismissal.feature` | the `dismissible` flag round-trips through create and re-read, for a dismissible and a non-dismissible announcement; the per-user suppression belongs to the host shell and is not asserted here |
| MUTATION | `features/admin/appeals-decide.feature` | Appeals console: an admin approves a mod-referred appeal; the referring mod cannot decide it; a cross-domain admin cannot decide another brand's appeal (victim-creates-first) |
| EVERY-FUNCTION | `features/admin/desktop-governance.feature` | Desktop-governance console: `@offline` a domain admin never sees the superadmin-only SSH-dials tab, a dark dial leg hides it too, and the terminal and sudo controls stay disabled with no device; `@cluster` the BFF role matrix behind sudo, step-up mint, remote install and the SSH terminal. No scenario dials a device |
| MUTATION | `features/admin/namespace-access.feature` | Namespace-access console: a domain admin grants a user a namespace; a mod's grant is denied; a cross-domain admin's grant list excludes another brand's grant |
| MUTATION | `features/admin/role-grant.feature` | `POST/DELETE /bff/admin/roles/{roleName}/{user}`: an admin grants then revokes `ROLE_MATRIX`; a mod's grant POST → 403 |
| MUTATION | `features/admin/superadmin-domains.feature` | Domains console: a superadmin registers a domain through the console; a domain admin's create POST → 403 |
| EVERY-FUNCTION | `features/admin/theme-editor-axes.feature` | `@offline` the Themes editor offers the ramp, style and nav-decoration choices; one `@fixme` scenario records the missing background-effect axis (host-shell issue 19) |

## Two lanes: `@offline` (default, runs on `ng serve`) and `@cluster` (dark)

The wave-2b-1 suite ships everything that needs a live stack dark. The
every-function wave adds a second lane that **runs by default**: pure client-side
UI behaviour that needs no backend.

- **`@offline`**: client-side behaviour reachable with **no backend**: form
  validation, a client-side heuristic warning, empty or degraded states, a
  disabled control. These carry **no `@cluster` tag**, so the default config
  (`tags: 'not @cluster'`) INCLUDES them, and `npx bddgen` generates the offline
  lane (currently **17 scenarios in 8 files**, one of them tagged `@fixme`). They
  run against the standalone dev shell (`ng serve admin`, which mounts
  `ADMIN_ROUTES` at the root; see `src/app/app.routes.ts`) with `E2E_BASE_URL`
  pointed at it. Every assertion is a real observable state change that fails
  against a blank page, never a bare "element exists".
- **`@cluster`**: needs the host shell serving the remote, admin-bff and the
  Casdoor seed (real writes, the role and cross-domain DENY POSTs). Still
  filtered out by default; see "Running against a live stack" below.

### Offline UI lane (no cluster, no mocks)

```sh
# 1. serve the standalone admin remote (from the repo root)
npm install && npm start          # ng serve admin → prints http://localhost:<port>

# 2. run only the @offline lane against it (from e2e/)
cd e2e && npm install
E2E_BASE_URL=http://localhost:<port> npx bddgen
E2E_BASE_URL=http://localhost:<port> npx playwright test --grep-invert @cluster
```

No backend is started. The components render their default, empty or degraded
states: their BFF fetches reject and the templates show their fallbacks, or the
fail-safe absent capability envelope drives the capability gate.
One exception: the theme-editor scenarios answer `GET /bff/admin/themes` with a
Playwright `page.route()` stub that returns one themed domain, because the editor
needs a row to open (`features/admin/theme-editor-axes.feature`).

## Ships dark (wave 2b-1)

Every scenario that needs a live stack (host shell serving the remote, admin-bff
and the Casdoor seed) is tagged **`@cluster`**. The tag sits at the feature level,
or at the scenario level in the every-function features, which mix an `@offline`
and a `@cluster` scenario in one file. The default config filters those out
(`tags: 'not @cluster'`). The GitLab `e2e:bdd` job is `allow_failure: true` and
only *compiles and lists*; it never launches a browser. It stays green whether
the default lane is empty or holds the `@offline` scenarios.

`@cluster` is used deliberately instead of playwright-bdd's reserved `@skip`.
`@skip` drops a scenario from generation entirely (`bddgen` emits 0 specs for
it), so a `@skip`-tagged suite cannot be *discovered*. `@cluster` is a plain
filter tag: the no-filter validation below generates and lists every scenario
(**178 today across 34 files**), which proves the Gherkin compiles, while the
default config keeps the `@cluster` ones dark and surfaces the `@offline` lane.

## Structural validation (no cluster, no browser)

```sh
npm install
npx bddgen            # default: 'not @cluster' → the 17 @offline specs (run them via
                      # the Offline UI lane above; @cluster scenarios stay dark)

# Prove every feature compiles + all scenarios are discovered (no filter). The
# no-filter config is committed as pw-validate.config.ts (it drops the `not @cluster`
# tag filter the default config carries), so validation is just:
npx bddgen -c pw-validate.config.ts
npx playwright test --list -c pw-validate.config.ts   # → 178 tests in 34 files
```

## Running against a live stack (later wave)

Drop the `@cluster` tag from a feature (or run with an override config that omits
the `not @cluster` filter), export `E2E_BASE_URL` (default
`https://host.docker.internal:8443`) and give each seed user a password, then run
`npm run bdd`. A password resolves in this order: the per-role `E2E_*_PASSWORD`
variable (`E2E_ADMIN_A_PASSWORD`, `E2E_SUPERADMIN_PASSWORD`, `E2E_MOD_PASSWORD`
and so on), then `E2E_PASSWORD`, then the run-state file `.e2e-credentials` (found
upward from the working directory, or at `E2E_CREDENTIALS_FILE`) that
`make stack-seed` in hugmesh-generator writes. There is no literal fallback; an
unresolved password throws.
