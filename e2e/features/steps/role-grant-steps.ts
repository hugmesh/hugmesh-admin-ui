// Step definitions backing features/admin/role-grant.feature — the admin-bff's
// standalone Casdoor role grant/revoke (AdminController#grantRole/#revokeRole,
// POST/DELETE /bff/admin/roles/{roleName}/{user}). This is the REAL lever the
// cross-service "grant ROLE_MATRIX -> Matrix surface unlocks" loop rests on
// (see hugmesh-matrix-ui's access/role-grant-unlock-loop.feature for the
// other leg).
//
// BFF write: fires the same same-origin fetch the app's BffService fires
// (credentials:'include'), matching access-suspension-steps.ts' evidence
// standard — the assertion is the server's OWN response body, never a local
// echo.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce, roleGrantState } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The uniquified casdoor-user actually sent to the server for a feature-file
 *  base name (mirrors access-suspension-steps.ts' fullUserOf). */
function fullUserOf(base: string): string {
  const known = scenarioState.uniqueNames.get(base);
  if (!known) throw new Error(`No user "${base}" was granted/revoked in this scenario.`);
  return known;
}

When(
  '{string} grants the {string} role to {string} via the BFF',
  async ({ user }, admin: string, role: string, targetBase: string) => {
    const page = pageOf(user(admin).username);
    // Uniquify so a repeat run against a live stack cannot collide with a
    // stale Casdoor role-membership entry from a prior run.
    const target = `${targetBase}-${scenarioNonce()}`;
    scenarioState.uniqueNames.set(targetBase, target);
    const result = await page.evaluate(
      async ([url]) => {
        const r = await fetch(url, { method: 'POST', credentials: 'include' });
        const body = await r.json().catch(() => null);
        return { status: r.status, body };
      },
      [`/bff/admin/roles/${role}/${encodeURIComponent(target)}`] as const,
    );
    // Honest ALLOW: the grant must really succeed (200,
    // AdminController#grantRole) — this is the oracle the response-body
    // assertion below is measured against.
    expect(result.status, 'the role grant must succeed (200)').toBe(200);
    roleGrantState.lastBody = result.body as Record<string, unknown> | null;
  },
);

When(
  '{string} revokes the {string} role from {string} via the BFF',
  async ({ user }, admin: string, role: string, targetBase: string) => {
    const page = pageOf(user(admin).username);
    const target = fullUserOf(targetBase);
    const result = await page.evaluate(
      async ([url]) => {
        const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
        const body = await r.json().catch(() => null);
        return { status: r.status, body };
      },
      [`/bff/admin/roles/${role}/${encodeURIComponent(target)}`] as const,
    );
    expect(result.status, 'the role revoke must succeed (200)').toBe(200);
    roleGrantState.lastBody = result.body as Record<string, unknown> | null;
  },
);

Then(
  'the role response reports {string} role {string} for {string}',
  async ({}, verb: string, role: string, targetBase: string) => {
    const target = fullUserOf(targetBase);
    const body = roleGrantState.lastBody;
    // Honest oracle: the assertion reads the LAST grant/revoke call's own JSON
    // body (Map.of("granted"|"revoked", roleName, "user", user)) — never a
    // locally-fabricated echo.
    expect(body, 'expected a JSON body from the grant/revoke response').toBeTruthy();
    expect(body![verb.toLowerCase()]).toBe(role);
    expect(body!['user']).toBe(target);
  },
);
