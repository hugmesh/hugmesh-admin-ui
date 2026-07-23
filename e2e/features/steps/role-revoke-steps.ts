// Step definitions backing features/admin/role-revoke-mid-session.feature — the
// LIVE-victim leg of the role grant/revoke lever. role-grant.feature proves the
// lever against a uniquified throwaway user; this proves the CONSEQUENCE on a real
// open session: an admin logged in with ROLE_ADMIN loses their access the moment a
// superadmin revokes it (AdminController#revokeRole best-effort revokes the
// grantee's live custody JWT via GatewayRevocationClient, so the change bites now,
// not after the ~1h TTL). The scenario re-grants at the end so the seed is restored.
//
// Distinct from role-grant-steps.ts: those uniquify the target (never touching a real
// seed); here the target IS the live victim, so we register the real username into the
// shared uniqueNames map and reuse role-grant-steps' response-body oracle.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState, roleGrantState, scenarioState } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** POST/DELETE the role for the REAL victim (their live Casdoor username), capturing
 *  the server's own {granted|revoked, user} body as the oracle. Registers the real
 *  username under the victim's feature-file name so role-grant-steps' shared
 *  "the role response reports ..." assertion resolves it. */
async function mutateLiveVictimRole(
  admin: string,
  method: 'POST' | 'DELETE',
  role: string,
  victimUsername: string,
): Promise<void> {
  const page = pageOf(admin);
  const result = await page.evaluate(
    async ([url, method]) => {
      const r = await fetch(url, { method, credentials: 'include' });
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    },
    [`/bff/admin/roles/${role}/${encodeURIComponent(victimUsername)}`, method] as const,
  );
  const verb = method === 'POST' ? 'grant' : 'revoke';
  expect(result.status, `the role ${verb} must succeed (200)`).toBe(200);
  roleGrantState.lastBody = result.body as Record<string, unknown> | null;
}

When(
  '{string} revokes the {string} role from the live victim {string} via the BFF',
  async ({ user }, admin: string, role: string, victimBase: string) => {
    const victim = user(victimBase).username;
    scenarioState.uniqueNames.set(victimBase, victim);
    await mutateLiveVictimRole(user(admin).username, 'DELETE', role, victim);
  },
);

When(
  '{string} re-grants the {string} role to the live victim {string} via the BFF',
  async ({ user }, admin: string, role: string, victimBase: string) => {
    const victim = user(victimBase).username;
    scenarioState.uniqueNames.set(victimBase, victim);
    await mutateLiveVictimRole(user(admin).username, 'POST', role, victim);
  },
);

Then("{string}'s live admin read is cut by the revocation", async ({}, _username: string) => {
  // The mid-session consequence. NOTE ON THE STATUS: the gateway's BFF-session
  // revocation boundary answers a revoked custody token with EITHER 401 (the
  // introspect-not-found passthrough → the protected route's authenticated() rule)
  // OR 403 (BffSessionAuthFilter.rejectForbidden on a bff-forbidden introspect) —
  // this is the platform's OWN documented contract (snapdragon-gateway
  // BffSessionAuthFilter lines 177-189; admin-bff RevocationFilterTest: "401/403 at
  // the gateway filter boundary"). It is NOT a single deterministic value, so
  // asserting either specific number would be a guess; we assert the honest
  // invariant instead: the read that was 200 a moment ago is now a client-side
  // DENY (4xx), never still 200.
  const status = responseState.lastStatus;
  expect([401, 403]).toContain(status);
});
