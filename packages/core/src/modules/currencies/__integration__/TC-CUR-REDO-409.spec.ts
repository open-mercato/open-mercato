import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CUR-REDO-409 (issue #2506):
 *  - finding #2: redo of a *.create must re-materialize the row with the SAME id
 *    (no orphaned soft-deleted original, no new id). Verified for both
 *    currencies.currencies.create and currencies.exchange_rates.create.
 *  - finding #4: duplicate create for currencies / exchange_rates must surface as
 *    409 Conflict (not 400, not 500).
 *
 * Endpoints:
 *   - POST/GET/DELETE /api/currencies/currencies
 *   - POST/GET/DELETE /api/currencies/exchange-rates
 *   - POST /api/audit_logs/audit-logs/actions/undo  { undoToken }
 *   - POST /api/audit_logs/audit-logs/actions/redo  { logId }
 */

type CurrencyRow = { id: string; code: string };
type ExchangeRateRow = { id: string; fromCurrencyCode: string; toCurrencyCode: string };

type OperationMetadata = { id: string; undoToken: string; resourceId: string | null };

const randomCode = generateUniqueCurrencyCode;

function readOperation(res: APIResponse): OperationMetadata {
  const header = res.headers()['x-om-operation'] ?? '';
  const enc = header.startsWith('omop:') ? header.slice(5) : '';
  expect(enc, 'x-om-operation header carries an omop: payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(enc)) as { id?: string; undoToken?: string; resourceId?: string | null };
  expect(typeof payload.id, 'log id present in operation payload').toBe('string');
  expect(typeof payload.undoToken, 'undoToken present in operation payload').toBe('string');
  return { id: payload.id as string, undoToken: payload.undoToken as string, resourceId: payload.resourceId ?? null };
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken } });
  expect(res.status(), 'undo returns 200').toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok, 'undo ok').toBe(true);
}

async function redo(request: APIRequestContext, token: string, logId: string): Promise<APIResponse> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', { token, data: { logId } });
  expect(res.status(), 'redo returns 200').toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok, 'redo ok').toBe(true);
  return res;
}

async function getCurrencyById(request: APIRequestContext, token: string, id: string): Promise<CurrencyRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  expect(res.status()).toBe(200);
  return (((await res.json()) as { items?: CurrencyRow[] }).items ?? [])[0];
}

async function getRateById(request: APIRequestContext, token: string, id: string): Promise<ExchangeRateRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/exchange-rates?id=${encodeURIComponent(id)}`, { token });
  expect(res.status()).toBe(200);
  return (((await res.json()) as { items?: ExchangeRateRow[] }).items ?? [])[0];
}

async function deleteCurrency(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  } catch { /* ignore */ }
}

async function deleteRate(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `/api/currencies/exchange-rates?id=${encodeURIComponent(id)}`, { token });
  } catch { /* ignore */ }
}

test.describe('TC-CUR-REDO-409: redo keeps the original id; duplicate create returns 409', () => {
  test('redo of currencies.create restores the SAME id (no orphaned original)', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const code = randomCode();

      const createRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code, name: 'QA Redo Currency' },
      });
      expect(createRes.status(), 'create returns 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(await getCurrencyById(request, token, id), 'row is gone after create-undo').toBeFalsy();

      const redoRes = await redo(request, token, op.id);
      const redoOp = readOperation(redoRes);
      expect(redoOp.resourceId, 'redo log resourceId equals the original id').toBe(id);

      const restored = await getCurrencyById(request, token, id);
      expect(restored, 'currency exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME id, not a new one').toBe(id);
      expect(restored!.code, 'restored row keeps its code').toBe(code);
    } finally {
      await deleteCurrency(request, token, id);
    }
  });

  test('redo of exchange_rates.create restores the SAME id', async ({ request }) => {
    let token: string | null = null;
    let fromId: string | null = null;
    let toId: string | null = null;
    let rateId: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const fromCode = randomCode();
      const toCode = randomCode();

      const fromRes = await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data: { organizationId, tenantId, code: fromCode, name: 'QA From' } });
      expect(fromRes.status()).toBe(201);
      fromId = ((await fromRes.json()) as { id: string }).id;
      const toRes = await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data: { organizationId, tenantId, code: toCode, name: 'QA To' } });
      expect(toRes.status()).toBe(201);
      toId = ((await toRes.json()) as { id: string }).id;

      const rateRes = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token,
        data: { organizationId, tenantId, fromCurrencyCode: fromCode, toCurrencyCode: toCode, rate: '1.2345', date: '2026-01-15T10:00:00.000Z', source: 'qa-redo' },
      });
      expect(rateRes.status(), 'create rate returns 201').toBe(201);
      rateId = ((await rateRes.json()) as { id: string }).id;
      const op = readOperation(rateRes);

      await undo(request, token, op.undoToken);
      expect(await getRateById(request, token, rateId), 'rate gone after create-undo').toBeFalsy();

      const redoRes = await redo(request, token, op.id);
      expect(readOperation(redoRes).resourceId, 'redo resourceId equals original rate id').toBe(rateId);

      const restored = await getRateById(request, token, rateId);
      expect(restored, 'rate exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME rate id').toBe(rateId);
    } finally {
      await deleteRate(request, token, rateId);
      await deleteCurrency(request, token, fromId);
      await deleteCurrency(request, token, toId);
    }
  });

  test('duplicate currency code create returns 409', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const code = randomCode();

      const first = await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data: { organizationId, tenantId, code, name: 'QA Dup' } });
      expect(first.status(), 'first create 201').toBe(201);
      id = ((await first.json()) as { id: string }).id;

      const dup = await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data: { organizationId, tenantId, code, name: 'QA Dup 2' } });
      expect(dup.status(), 'duplicate currency code returns 409').toBe(409);
    } finally {
      await deleteCurrency(request, token, id);
    }
  });

  test('duplicate exchange rate (pair+date+source) create returns 409', async ({ request }) => {
    let token: string | null = null;
    let fromId: string | null = null;
    let toId: string | null = null;
    let rateId: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const fromCode = randomCode();
      const toCode = randomCode();

      fromId = ((await (await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data: { organizationId, tenantId, code: fromCode, name: 'QA From' } })).json()) as { id: string }).id;
      toId = ((await (await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data: { organizationId, tenantId, code: toCode, name: 'QA To' } })).json()) as { id: string }).id;

      const payload = { organizationId, tenantId, fromCurrencyCode: fromCode, toCurrencyCode: toCode, rate: '2.0', date: '2026-02-20T09:00:00.000Z', source: 'qa-409' };
      const first = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', { token, data: payload });
      expect(first.status(), 'first rate create 201').toBe(201);
      rateId = ((await first.json()) as { id: string }).id;

      const dup = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', { token, data: payload });
      expect(dup.status(), 'duplicate exchange rate returns 409').toBe(409);
    } finally {
      await deleteRate(request, token, rateId);
      await deleteCurrency(request, token, fromId);
      await deleteCurrency(request, token, toId);
    }
  });
});
