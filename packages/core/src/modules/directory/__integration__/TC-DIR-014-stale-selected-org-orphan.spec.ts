import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-014: A stale/dead `om_selected_org` selection must not silently write
 * to a fallback organization.
 * Covers: organization scope resolution + create guard across
 *   POST + GET /api/customers/companies.
 *
 * Background: an unrestricted (all-orgs) principal — e.g. superadmin — whose
 * selected-org cookie points at an organization that no longer resolves (a dead
 * UUID, as happens after a DB reset reassigns the org a new id while the browser
 * keeps the old cookie) used to have the write land under the dead org while the
 * read scope filtered by the caller's real accessible org: the record was
 * created (201) but immediately unreadable — silently orphaned.
 *
 * Fix: the scope resolver drops a selection that does not resolve to a real,
 * accessible org (keeping reads working) and flags it as rejected; the CRUD
 * factory then refuses the create with HTTP 422 rather than writing it under a
 * fallback org the caller never selected. This test drives the exact HTTP flow.
 *
 * Per-test metadata: needs both directory and customers modules enabled (the
 * folder meta only requires directory).
 */
export const integrationMeta = {
  dependsOnModules: ['directory', 'customers'],
};

// Syntactically valid v4 UUID that is not seeded — stands in for an org id that
// no longer resolves after a reset. Not a real record in any tenant.
const DEAD_SELECTED_ORG_ID = '00000000-0000-4000-8000-0000000000de';

function extractId(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    for (const key of ['id', 'entityId', 'companyId'] as const) {
      const value = (payload as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
  }
  return null;
}

function extractItems(payload: unknown): Array<Record<string, unknown>> {
  if (payload && typeof payload === 'object') {
    const items = (payload as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as Array<Record<string, unknown>>;
  }
  return [];
}

test.describe('TC-DIR-014: stale selected-org cookie must not orphan writes', () => {
  let token: string;
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    // superadmin is unrestricted (allowedIds === null) yet has a real seeded
    // account org — the precise shape that used to accept a dead selection.
    token = await getAuthToken(request, 'superadmin');
    // admin is scoped to a concrete org, so a plain create (no explicit org
    // selection) resolves to that org — used for the positive control.
    adminToken = await getAuthToken(request, 'admin');
  });

  test('rejects a create made under a dead om_selected_org cookie (422)', async ({ request }) => {
    const displayName = `TC-DIR-014 Reject ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const staleCookie = `om_selected_org=${DEAD_SELECTED_ORG_ID}`;
    let leakedId: string | null = null;

    try {
      const createRes = await request.fetch('/api/customers/companies', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: staleCookie,
          'Content-Type': 'application/json',
        },
        data: { displayName },
      });

      // The write must be refused loudly, not silently redirected to a fallback org.
      expect(
        createRes.status(),
        `create with a dead selected org should be rejected, got ${createRes.status()}`,
      ).toBe(422);
      const body = await readJsonSafe(createRes);
      expect((body as Record<string, unknown>)?.code).toBe('organization_selection_invalid');
      leakedId = extractId(body);
      expect(leakedId, 'no record should be created').toBeFalsy();
      // Writes must NOT auto-clear the selection — a mutation requires an
      // explicit, valid re-selection, never a silent fallback org.
      expect(
        createRes.headers()['set-cookie'] ?? '',
        'a rejected write must not clear the selected-org cookie',
      ).not.toContain('om_selected_org=;');
    } finally {
      if (leakedId) {
        await request
          .fetch(`/api/customers/companies?id=${leakedId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}`, Cookie: staleCookie },
          })
          .catch(() => {});
      }
    }
  });

  test('rejects a list read made under a dead om_selected_org cookie (422)', async ({ request }) => {
    // Reads are held to the same rule as writes: a stale selection must not
    // silently serve a different org's data than the one selected.
    const listRes = await request.fetch('/api/customers/companies?page=1&pageSize=1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `om_selected_org=${DEAD_SELECTED_ORG_ID}`,
      },
    });
    expect(
      listRes.status(),
      `list with a dead selected org should be rejected, got ${listRes.status()}`,
    ).toBe(422);
    const body = await readJsonSafe(listRes);
    expect((body as Record<string, unknown>)?.code).toBe('organization_selection_invalid');
    // Reads self-heal: the stale selection cookie is expired so the caller's
    // next request falls back to their home org (recovers even without a switcher).
    const setCookie = listRes.headers()['set-cookie'] ?? '';
    expect(setCookie, 'a rejected read should expire the stale selected-org cookie').toContain('om_selected_org=;');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });

  test('positive control: a normal create (no stale selection) succeeds and is readable', async ({ request }) => {
    const displayName = `TC-DIR-014 Control ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const authHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
    let companyId: string | null = null;

    try {
      const createRes = await request.fetch('/api/customers/companies', {
        method: 'POST',
        headers: authHeaders,
        data: { displayName },
      });
      expect(createRes.ok(), `create should succeed, got ${createRes.status()}`).toBeTruthy();
      companyId = extractId(await readJsonSafe(createRes));
      expect(companyId, 'create response should return an id').toBeTruthy();

      const listRes = await request.fetch(`/api/customers/companies?id=${companyId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.ok()).toBeTruthy();
      const match = extractItems(await readJsonSafe(listRes)).find((item) => extractId(item) === companyId);
      expect(match, 'a normally-created record must be readable back').toBeTruthy();
    } finally {
      if (companyId) {
        await request
          .fetch(`/api/customers/companies?id=${companyId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${adminToken}` },
          })
          .catch(() => {});
      }
    }
  });
});
