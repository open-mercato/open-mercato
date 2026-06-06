import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CURR-2453: a base-currency update that triggers the interleaved
 * `enforceBaseCurrency` read inside `withAtomicFlush` MUST persist its changed
 * scalar columns (#2453-class fix).
 *
 * Reproduction trigger (currencies.updateCurrencyCommand):
 *   The update command runs its second `withAtomicFlush` phase —
 *   `enforceBaseCurrency`'s `em.nativeUpdate` — only when
 *   `parsed.isBase === true && record.isBase`. That interleaved write on the
 *   same `EntityManager` is exactly what could discard the pending scalar
 *   changeset on the managed record under MikroORM v7. So we update a currency
 *   that is ALREADY the base, sending `isBase: true` together with scalar
 *   changes (symbol + name + decimalPlaces). PRE-FIX the PUT returned 200 and
 *   bumped updated_at, but the scalar columns reverted to their old values.
 *
 * Endpoints covered:
 *   - POST   /api/currencies/currencies                    (create)
 *   - GET    /api/currencies/currencies?id=&isBase=true    (read / base count)
 *   - PUT    /api/currencies/currencies                    (update — the trigger)
 *   - DELETE /api/currencies/currencies?id=                (cleanup)
 *
 * Asserts:
 *   1. The scalar changes (symbol, name, decimalPlaces) round-trip to the new
 *      values on re-fetch — not merely a 200 response.
 *   2. The record stays the base, and exactly one base currency remains in the
 *      tenant (the interleaved demotion ran and committed atomically).
 */

type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
  isBase: boolean;
  isActive: boolean;
};

const randomCode = generateUniqueCurrencyCode;

async function getById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CurrencyRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  expect(res.status(), 'GET by id returns 200').toBe(200);
  const body = (await res.json()) as { items?: CurrencyRow[] };
  return (body.items ?? [])[0];
}

async function listBases(request: APIRequestContext, token: string): Promise<CurrencyRow[]> {
  const res = await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true', { token });
  expect(res.status(), 'GET isBase=true returns 200').toBe(200);
  const body = (await res.json()) as { items?: CurrencyRow[] };
  return body.items ?? [];
}

async function cleanupCurrency(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  // A base currency cannot be deleted; demote it first, then delete.
  try {
    await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id, isBase: false } });
  } catch {
    /* ignore */
  }
  try {
    await apiRequest(request, 'DELETE', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  } catch {
    /* ignore */
  }
}

test.describe('TC-CURR-2453: base-currency update persists scalar changes through the interleaved read', () => {
  test('updating the base currency with isBase:true + scalar changes persists the scalars (not just 200)', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    let priorBaseId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      expect(organizationId, 'admin token carries an organization id').toBeTruthy();
      expect(tenantId, 'admin token carries a tenant id').toBeTruthy();

      // Capture any pre-existing base so we can restore shared state afterwards.
      const priorBases = await listBases(request, token);
      expect(priorBases.length, 'at most one base currency exists initially').toBeLessThanOrEqual(1);
      priorBaseId = priorBases[0]?.id ?? null;

      const code = randomCode();
      const createRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: {
          organizationId,
          tenantId,
          code,
          name: 'QA 2453 Original',
          symbol: 'O',
          decimalPlaces: 2,
          isBase: true,
          isActive: true,
        },
      });
      expect(createRes.status(), 'create base currency returns 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'create returns an id').toBeTruthy();

      // Sanity: the new record is the single base before the update.
      const beforeUpdate = await getById(request, token, id);
      expect(beforeUpdate, 'created currency readable by id').toBeTruthy();
      expect(beforeUpdate!.isBase, 'record is the base before the update').toBe(true);

      // THE TRIGGER: PUT isBase:true (record is already base) together with scalar
      // changes. This fires the interleaved enforceBaseCurrency nativeUpdate inside
      // withAtomicFlush. The scalar changeset on the managed record must survive it.
      const updatePayload = {
        id,
        name: 'QA 2453 Changed',
        symbol: '#',
        decimalPlaces: 4,
        isBase: true,
      };
      const updateRes = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token,
        data: updatePayload,
      });
      expect(updateRes.status(), 'update returns 200').toBe(200);

      // The critical assertion: the changed scalar columns round-trip to the new
      // values. PRE-FIX these reverted to 'QA 2453 Original' / 'O' / 2.
      const afterUpdate = await getById(request, token, id);
      expect(afterUpdate, 'updated currency readable by id').toBeTruthy();
      expect(afterUpdate!.name, 'name change persisted past the interleaved read').toBe(updatePayload.name);
      expect(afterUpdate!.symbol, 'symbol change persisted past the interleaved read').toBe(updatePayload.symbol);
      expect(afterUpdate!.decimalPlaces, 'decimalPlaces change persisted past the interleaved read').toBe(
        updatePayload.decimalPlaces,
      );

      // The record stays the base, and the interleaved demotion kept exactly one base.
      expect(afterUpdate!.isBase, 'record is still the base after the update').toBe(true);
      const basesAfter = await listBases(request, token);
      expect(basesAfter.length, 'exactly one base currency remains after the update').toBe(1);
      expect(basesAfter[0].id, 'the updated record is the single base').toBe(id);
    } finally {
      await cleanupCurrency(request, token, id);
      // Restore the original base so we leave shared tenant state as we found it.
      if (token && priorBaseId) {
        try {
          await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id: priorBaseId, isBase: true } });
        } catch {
          /* ignore */
        }
      }
    }
  });
});
