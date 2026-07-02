// Shared per-scenario state. playwright-bdd recreates the test instance for
// each scenario so we reset these maps in the After() hook in
// features/support/fixtures.ts. Keys are usernames so steps can reference a user
// by name without threading a token/page through.

import { BrowserContext, Page } from '@playwright/test';

export const pageRegistry = new Map<string, Page>();
export const ctxRegistry = new Map<string, BrowserContext>();

/** Last HTTP status code captured by an API-style step (the cross-user DENY
 *  assertions read this). Module-global instead of test-info attached so the
 *  assertion step doesn't need to thread the World through. Cleared on
 *  scenario teardown. */
export const responseState = { lastStatus: 0 };

/** Per-scenario state for the REAL-WRITE (mutation) scenarios. `nonce` makes
 *  every created resource name unique per run (repeat runs against a live
 *  stack must not collide); the maps translate the declarative names used in
 *  .feature lines to the real, server-issued ids / uniquified names — the
 *  victim-creates-first oracle (a DENY is only meaningful against a REAL
 *  resource id the victim captured). Cleared on scenario teardown. */
export const scenarioState = {
  nonce: '',
  /** BFF-created announcements: feature-file title → { id, fullTitle }. */
  announcements: new Map<string, { id: string; fullTitle: string }>(),
  /** Uniquified names typed into UI forms: feature-file name → real value. */
  uniqueNames: new Map<string, string>(),
};

/** Lazily mint the per-scenario uniquifier (lowercase alnum, DNS-label safe). */
export function scenarioNonce(): string {
  if (!scenarioState.nonce) {
    scenarioState.nonce =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  return scenarioState.nonce;
}

export function resetRegistry(): void {
  pageRegistry.clear();
  ctxRegistry.clear();
  responseState.lastStatus = 0;
  scenarioState.nonce = '';
  scenarioState.announcements.clear();
  scenarioState.uniqueNames.clear();
}
