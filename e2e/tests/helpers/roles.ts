import * as fs from 'fs';
import * as path from 'path';
import { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Catalogue of Casdoor seed users for the admin-ui e2e matrix. Adapted from the
 * proven hugmesh.games/e2e helper, but keyed to THIS app's session model:
 * the admin-ui (and its host) persist a {@link HugSession} under the
 * `hug.session` localStorage key (see src/app/session.service.ts), whose
 * `roles: string[]` drives every guard — adminGuard, superadminGuard,
 * gamesServicesGuard — and the lowercased, ROLE_-prefix-stripped role flags.
 *
 * The admin-ui is the MULTI-TENANT AUTHZ KEYSTONE, so the catalogue is built to
 * exercise the THREE coverage classes the wave demands:
 *   - USER-SITUATIONAL  — each admin / superadmin surface, ALLOW + DENY.
 *   - MULTIUSER         — an admin acting over their own domain.
 *   - CROSS-USER        — a domain-A admin DENIED on a domain-B resource, and a
 *                         plain admin DENIED on a superadmin-only console.
 *
 * The `kind` tag selects which role-specific assertions a feature drives. The
 * `domain` tag drives the cross-domain isolation scenarios. Passwords resolve
 * via {@link passwordFor} — per-user override env, then the shared
 * `E2E_PASSWORD` env, then the run-state credentials file that
 * `make stack-seed` (hugmesh-generator) writes. There is no literal fallback:
 * an unresolved password throws rather than silently authenticating with a
 * guessable default.
 */
export type RoleKind = 'admin' | 'superadmin' | 'mod' | 'games-admin' | 'games-runner' | 'fleet-admin' | 'user';

export interface SeedUser {
  /** CLI-friendly username referenced from .feature lines. */
  username: string;
  /** env var the compose overlay routes the cred through. */
  passwordEnv: string;
  /** Identity provider — admin-ui sessions are google- or discord-backed. */
  provider: 'google' | 'discord';
  /** The lowercased Casdoor roles this user carries in `hug.session.roles`. */
  roles: string[];
  /** Drives role-specific assertions. */
  kind: RoleKind;
  /** Brand/domain this user administers — used by the cross-domain DENY specs. */
  domain?: string;
}

export const SEED_USERS: SeedUser[] = [
  // ── Superadmin — the only role that may reach the additionally-guarded
  //    superadmin-only consoles (device-licenses, device-pending, egress-vpn,
  //    superadmin/domains, superadmin/anubis, the cloud-backups TOTAL tab).
  { username: 'superadmin', passwordEnv: 'E2E_SUPERADMIN_PASSWORD', provider: 'google', roles: ['superadmin', 'admin'], kind: 'superadmin' },

  // ── Domain admins — the multi-tenant keystone. `admin-domain-a` and
  //    `admin-domain-b` administer DIFFERENT brands; the cross-user isolation
  //    scenarios assert each is DENIED on the other's domain-scoped resource and
  //    on every superadmin-only console.
  { username: 'admin-domain-a', passwordEnv: 'E2E_ADMIN_A_PASSWORD', provider: 'google',  roles: ['admin'], kind: 'admin', domain: 'domain-a' },
  { username: 'admin-domain-b', passwordEnv: 'E2E_ADMIN_B_PASSWORD', provider: 'discord', roles: ['admin'], kind: 'admin', domain: 'domain-b' },

  // ── Games app-store derived roles. The ADMIN may create/enable; the RUNNER is
  //    mod-delegated run/stop only and the console greys-out create with the
  //    `gs-runner-help` helptext (the real ALLOW+DENY+helptext surface).
  { username: 'games-admin',  passwordEnv: 'E2E_GAMES_ADMIN_PASSWORD',  provider: 'google',  roles: ['admin', 'games_services_admin'],  kind: 'games-admin',  domain: 'domain-a' },
  { username: 'games-runner', passwordEnv: 'E2E_GAMES_RUNNER_PASSWORD', provider: 'discord', roles: ['games_services_runner'],           kind: 'games-runner', domain: 'domain-a' },

  // ── Fleet owner — a NON-superadmin FLEET_ADMIN (no admin/superadmin role). Reaches the
  //    PUBLIC "My fleet" ({@code /bff/admin/phone-fleet}) owner surface via fleetAdminGuard, but
  //    is DENIED every superadmin-only console (phone-fleet, fleet-entitlements) and the
  //    superadmin phone-devices/fleet-entitlements BFF plane (403). The BFF ALSO gates the
  //    fleet surface on a per-subject entitlement + owner-within-domain wall.
  { username: 'fleet-owner-a', passwordEnv: 'E2E_FLEET_OWNER_PASSWORD', provider: 'google', roles: ['fleet_admin'], kind: 'fleet-admin', domain: 'domain-a' },

  // ── Mod — the SIBLING role, not a subset of admin. A mod carries real
  //    moderation power over their domain (mod-ui / mod-bff) but must be DENIED
  //    every admin console: adminGuard admits only 'admin', so the UI bounces a
  //    mod to /login, and the admin-bff URL gate (/bff/admin/** requires
  //    ROLE_ADMIN|ROLE_SUPERADMIN) answers 403. The sibling-not-superset rule.
  { username: 'mod-user', passwordEnv: 'E2E_MOD_PASSWORD', provider: 'discord', roles: ['mod'], kind: 'mod', domain: 'domain-a' },

  // ── Plain user — no admin role at all; bounced to /login by adminGuard. The
  //    floor of the DENY matrix.
  { username: 'plain-user', passwordEnv: 'E2E_USER_PASSWORD', provider: 'google', roles: [], kind: 'user' },
];

/**
 * Walk up from `dir` looking for `filename`, the way you'd look for a `.git`
 * or `package.json` root. This repo is a CONSUMER of hugmesh-generator's
 * credentials file, not the generator: Playwright runs in its own process
 * (possibly its own container) and may be invoked with `cwd` at the repo root
 * or at `e2e/`, either of which the generator could consider "here" when it
 * wrote `.e2e-credentials`. Returns `undefined` — never throws — when the walk
 * reaches the filesystem root without a match.
 */
function findUpward(filename: string, dir: string): string | undefined {
  for (;;) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * The run-state credentials file path to use: `E2E_CREDENTIALS_FILE` verbatim
 * if set (its existence is checked when reading, not here — an explicit path
 * that doesn't exist yet should show up in the error message, not be silently
 * swapped for something else), otherwise the nearest `.e2e-credentials`
 * walking up from `cwd`, otherwise the conventional `<cwd>/.e2e-credentials`
 * path (used only for the "not found" error message).
 */
function credentialsFilePath(): string {
  return (
    process.env['E2E_CREDENTIALS_FILE']
    ?? findUpward('.e2e-credentials', process.cwd())
    ?? path.join(process.cwd(), '.e2e-credentials')
  );
}

/**
 * Parse the plain `KEY=value` run-state credentials file written by
 * hugmesh-generator's `e2e_password_ensure()` (`tests/stack/e2e-password.sh`
 * in that repo — no quoting, no `export` keyword, so it also sources with
 * `set -a; . file; set +a` and loads via `docker compose --env-file`).
 *
 * A missing or unreadable file is the expected, common case — a fresh
 * checkout before anyone has run `make stack-seed` — so this returns an empty
 * map rather than throwing; the caller turns "nothing resolved" into one clear
 * error instead of letting an `ENOENT` stack trace stand in for it.
 */
function readCredentialsFile(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return values;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return values;
}

/**
 * Resolve a seed user's password. Precedence (Rule 4 of the random-password
 * contract — consumers RESOLVE, they never invent):
 *
 *   1. the per-user override, `process.env[user.passwordEnv]`
 *   2. the shared override/propagation var, `process.env.E2E_PASSWORD`
 *   3. the run-state credentials file (`E2E_CREDENTIALS_FILE` or a
 *      `.e2e-credentials` walked up from `cwd`), checked under the same two
 *      keys in the same order
 *
 * If none of those resolve, this THROWS — naming `make stack-seed` and the
 * file path it looked for — instead of ever falling back to a literal. A
 * silent literal default is the exact bug this replaces: it would let a
 * misconfigured run authenticate with a guessable password and still go
 * green.
 */
export function passwordFor(user: SeedUser): string {
  const perUser = process.env[user.passwordEnv];
  if (perUser) {
    return perUser;
  }

  const shared = process.env['E2E_PASSWORD'];
  if (shared) {
    return shared;
  }

  const filePath = credentialsFilePath();
  const fromFile = readCredentialsFile(filePath);
  const fileValue = fromFile.get(user.passwordEnv) ?? fromFile.get('E2E_PASSWORD');
  if (fileValue) {
    return fileValue;
  }

  throw new Error(
    `No e2e password for seed user "${user.username}": neither $${user.passwordEnv} nor $E2E_PASSWORD is ` +
      `set, and neither key was found in the run-state credentials file (${filePath}). Run \`make stack-seed\` ` +
      `(hugmesh-generator) to seed the stack and write that file, or export E2E_CREDENTIALS_FILE to point at ` +
      `wherever it was written, then re-run.`,
  );
}

/**
 * Create a fresh browser context that trusts the e2e self-signed cert AND uses
 * the same baseURL as the playwright config. The default `browser.newContext()`
 * does NOT inherit project-level `use` options (Playwright design choice), so a
 * spec that opens a manual context misses `ignoreHTTPSErrors: true` and every
 * HTTPS request fails the cert check — the native-federation manifest fetch is
 * the first casualty. Specs that need multiple users in parallel (the cross-user
 * isolation matrix) MUST call this instead of `browser.newContext()`.
 */
export async function newE2eContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
}

/**
 * Drive the federated login form and wait for `hug.session` in localStorage.
 *
 * @cluster-only — this helper hits a LIVE Casdoor + host shell, so it is only
 * exercised by scenarios tagged `@cluster` today (they ship dark: the default
 * config filters `not @cluster`; a no-filter bddgen still compiles them). A
 * later wave re-enables a feature by dropping its `@cluster` tag — no step
 * rewrite needed.
 *
 * The admin-ui's host shell renders the login micro-frontend; on success the
 * SessionService writes `hug.session` (see set()/broadcast()) and the gateway
 * sets the HttpOnly `bff_` cookie via Set-Cookie. We wait for the non-secret
 * `hug.session` key to appear so a follow-up guarded navigation doesn't race the
 * write (the bearer no longer lives in the browser — auth rides the cookie).
 */
export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // login-ui's form (login.component.html) is template-driven and carries NO
  // formControlName; its selector contract is data-testid login-username /
  // login-password / login-submit. The old formControlName-attribute input and
  // login-btn class selectors matched nothing (measured 2026-09-23 against the
  // compose stack: the username wait timed out on every "is logged in" row).
  await page.locator('[data-testid="login-username"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('[data-testid="login-username"]', user.username);
  await page.fill('[data-testid="login-password"]', passwordFor(user));
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem('hug.session');
      if (!raw) return false;
      try {
        // The mirror login-ui writes carries `roles` but no `id` (measured
        // 2026-09-23: signed in, yet a `.id` wait timed out), so wait on roles.
        return Array.isArray(JSON.parse(raw).roles);
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Seed a {@link HugSession} directly into localStorage WITHOUT a Casdoor round
 * trip. Mirrors the shape SessionService.set() writes, so guards reading the
 * `roles` array behave exactly as in production. Used by the offline/dark
 * scenarios that assert pure client-side guard behaviour (skip-link focus,
 * disabled+helptext) without needing the BFF — and by the live scenarios as a
 * faster alternative to a full login where the token is not exercised.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    registrationComplete: true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['hug.session', JSON.stringify(session)] as const,
  );
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's guard check. */
export async function clearSession(page: Page): Promise<void> {
  // A scenario's fresh page is `about:blank`, whose localStorage is not readable
  // (SecurityError: "Access is denied for this document") and holds no session
  // anyway — so `a clean session` as a FIRST step used to throw before the scenario
  // began. Only clear once an app origin is loaded.
  if (!/^https?:/.test(page.url())) return;
  await page.evaluate(() => window.localStorage.removeItem('hug.session'));
}
