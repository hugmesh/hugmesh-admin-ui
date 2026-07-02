# snapdragon-admin-ui — e2e (Playwright + playwright-bdd)

Gherkin-driven end-to-end harness for the admin-ui federated remote, copied from
the proven `snapdragon.games/e2e` pattern (`@playwright/test` +
`playwright-bdd`, single-worker serial, `screenshot:'on'`/`video:'on'`, HTML
reporter, the per-step PNG `AfterStep` hook in
`features/support/fixtures.ts`).

The admin-ui is the **multi-tenant authorization keystone**, so this suite leads
with the deepest cross-user / DENY coverage:

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

## Ships dark (wave 2b-1)

Every scenario that needs a live stack (host shell serving the remote +
admin-bff + Casdoor seed) is tagged **`@cluster`** at the feature level. The
default config filters them out (`tags: 'not @cluster'`), so the default run
needs **no cluster** and the GitLab `e2e:bdd` job is `allow_failure: true`.

`@cluster` is used deliberately instead of playwright-bdd's reserved `@skip`:
`@skip` drops a scenario from generation entirely (`bddgen` emits 0 specs for
it), so a `@skip`-tagged suite cannot be *discovered*. `@cluster` is a plain
filter tag — the no-filter validation below generates and lists all 65
scenarios, proving the Gherkin compiles, while the default config keeps them
dark.

## Offline validation (no cluster)

```sh
npm install
npx bddgen            # default: 'not @cluster' → 0 specs (ships dark, intended)

# Prove every feature compiles + all scenarios are discovered (no filter):
cat > pw-validate.config.ts <<'EOF'
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const d = defineBddConfig({ features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'features/support/**/*.ts'] });
export default defineConfig({ reporter: [['list']],
  use: { ignoreHTTPSErrors: true, screenshot: 'on', video: 'on' },
  projects: [{ name: 'bdd', testDir: d, use: { ...devices['Desktop Chrome'] } }] });
EOF
npx bddgen -c pw-validate.config.ts
npx playwright test --list -c pw-validate.config.ts   # → 65 tests in 8 files
rm pw-validate.config.ts
```

## Running against a live stack (later wave)

Drop the `@cluster` tag from a feature (or run with an override config that
omits the `not @cluster` filter), export `E2E_BASE_URL` + the per-role
`E2E_*_PASSWORD` vars, then `npm run bdd`.
