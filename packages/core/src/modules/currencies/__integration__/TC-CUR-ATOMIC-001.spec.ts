import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { generateUniqueCurrencyCode } from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-ATOMIC-001: base-currency writes are atomic (#2338, part of #2333).
 *
 * Guards the `enforceBaseCurrency` + record flush wrapping in
 * `currencies.currencies` create/update. The audited risk is a partial commit
 * that demotes the existing base currency but fails to persist the new one,
 * leaving the organization with zero or two base currencies.
 *
 * Note: forcing a mid-transaction flush failure deterministically requires a
 * code-level seam, which is covered by the unit suite
 * (`currencies.atomicity.test.ts`: rollback + no side effects on flush failure).
 * These tests assert the observable invariant on a real database: the base flag
 * is always single-valued, and a rejected create leaves no partial row.
 */

const randomCode = generateUniqueCurrencyCode;

type CurrencyRow = { id: string; code: string; isBase: boolean };

async function getCurrency(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CurrencyRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items?: CurrencyRow[] };
  return (body.items ?? [])[0];
}

async function setBase(request: APIRequestContext, token: string, id: string, isBase: boolean): Promise<void> {
  const res = await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id, isBase } });
  expect(res.ok(), `PUT isBase=${isBase} should succeed`).toBeTruthy();
}

async function cleanupCurrency(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  try {
    await setBase(request, token, id, false);
  } catch {
    /* ignore */
  }
  try {
    await apiRequest(request, 'DELETE', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  } catch {
    /* ignore */
  }
}

test.describe('TC-CUR-ATOMIC-001: base-currency writes are atomic', () => {
  test('switching the base currency demotes the previous base in one transaction', async ({ request }) => {
    let token: string | null = null;
    let aId: string | null = null;
    let bId: string | null = null;
    let priorBaseId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      // Capture any pre-existing base so we can restore it (do not rely on seeded data).
      const priorBaseRes = await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true', { token });
      expect(priorBaseRes.status()).toBe(200);
      priorBaseId = (((await priorBaseRes.json()) as { items?: CurrencyRow[] }).items ?? [])[0]?.id ?? null;

      const aRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code: randomCode(), name: 'QA Atomic A', isBase: true },
      });
      expect(aRes.status(), 'create A as base').toBe(201);
      aId = ((await aRes.json()) as { id: string }).id;

      const bRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code: randomCode(), name: 'QA Atomic B', isBase: true },
      });
      expect(bRes.status(), 'create B as base').toBe(201);
      bId = ((await bRes.json()) as { id: string }).id;

      // Creating B as base must have demoted A within the same transaction.
      expect((await getCurrency(request, token, aId))?.isBase, 'A demoted after B became base').toBe(false);
      expect((await getCurrency(request, token, bId))?.isBase, 'B is the base').toBe(true);

      // Switch the base back to A via update.
      await setBase(request, token, aId, true);
      expect((await getCurrency(request, token, aId))?.isBase, 'A is base after switch').toBe(true);
      expect((await getCurrency(request, token, bId))?.isBase, 'B demoted after switch').toBe(false);
    } finally {
      await cleanupCurrency(request, token, aId);
      await cleanupCurrency(request, token, bId);
      // Restore the original base currency so we leave shared state as we found it.
      if (token && priorBaseId) {
        try {
          await setBase(request, token, priorBaseId, true);
        } catch {
          /* ignore */
        }
      }
    }
  });

  test('rejecting a duplicate currency code leaves no partial row', async ({ request }) => {
    let token: string | null = null;
    let aId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const code = randomCode();

      const aRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code, name: 'QA Atomic Dup' },
      });
      expect(aRes.status(), 'create original currency').toBe(201);
      aId = ((await aRes.json()) as { id: string }).id;

      const dupRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code, name: 'QA Atomic Dup 2', isBase: true },
      });
      expect(dupRes.status(), 'duplicate code rejected').toBeGreaterThanOrEqual(400);

      // Exactly one row for the code — the rejected create persisted nothing.
      const listRes = await apiRequest(request, 'GET', `/api/currencies/currencies?code=${encodeURIComponent(code)}`, { token });
      expect(listRes.status()).toBe(200);
      const items = ((await listRes.json()) as { items?: CurrencyRow[] }).items ?? [];
      expect(items.filter((row) => row.code === code).length, 'exactly one row for the code').toBe(1);
    } finally {
      await cleanupCurrency(request, token, aId);
    }
  });
});
