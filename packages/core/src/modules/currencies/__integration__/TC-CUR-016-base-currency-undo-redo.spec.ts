import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CUR-016: exactly one base currency per organization survives undo, redo and stale undo.
 *
 * Endpoints:
 *   - POST/PUT/GET/DELETE /api/currencies/currencies
 *   - POST/DELETE /api/currencies/exchange-rates
 *   - POST /api/audit_logs/audit-logs/actions/undo  { undoToken }
 *   - POST /api/audit_logs/audit-logs/actions/redo  { logId }
 *
 * Fixtures are removed in afterEach after the prior base is restored. When the organization had no
 * base currency, the base fixture created in beforeEach stays: a base currency cannot be un-flagged
 * or deleted by design.
 */

type CurrencyRow = { id: string; code: string; name: string; isBase: boolean };
type Operation = { id: string; undoToken: string };
type Scope = { organizationId: string; tenantId: string };

function readOperation(res: APIResponse): Operation {
  const header = res.headers()['x-om-operation'] ?? '';
  const encoded = header.startsWith('omop:') ? header.slice(5) : '';
  expect(encoded, 'x-om-operation header carries an omop: payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(encoded)) as { id?: string; undoToken?: string };
  expect(typeof payload.id, 'log id present').toBe('string');
  expect(typeof payload.undoToken, 'undo token present').toBe('string');
  return { id: payload.id as string, undoToken: payload.undoToken as string };
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken } });
}

async function redo(request: APIRequestContext, token: string, logId: string): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', { token, data: { logId } });
}

async function listBases(request: APIRequestContext, token: string): Promise<CurrencyRow[]> {
  const res = await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true&pageSize=100', { token });
  expect(res.status(), 'GET isBase=true returns 200').toBe(200);
  return ((await res.json()) as { items?: CurrencyRow[] }).items ?? [];
}

async function getCurrency(request: APIRequestContext, token: string, id: string): Promise<CurrencyRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  expect(res.status()).toBe(200);
  return (((await res.json()) as { items?: CurrencyRow[] }).items ?? [])[0];
}

async function expectSingleBase(request: APIRequestContext, token: string, id: string, label: string): Promise<void> {
  const bases = await listBases(request, token);
  expect(bases.map((row) => row.id), label).toEqual([id]);
}

async function createCurrency(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  isBase: boolean,
): Promise<{ id: string; code: string; operation: Operation }> {
  const code = generateUniqueCurrencyCode();
  const res = await apiRequest(request, 'POST', '/api/currencies/currencies', {
    token,
    data: { ...scope, code, name: `QA TC-CUR-016 ${code}`, isBase },
  });
  expect(res.status(), `create ${code}`).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  return { id, code, operation: readOperation(res) };
}

async function promote(request: APIRequestContext, token: string, id: string, extra: Record<string, unknown> = {}): Promise<Operation> {
  const res = await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id, isBase: true, ...extra } });
  expect(res.status(), `promote ${id}`).toBe(200);
  return readOperation(res);
}

async function deleteQuietly(request: APIRequestContext, token: string, path: string, id: string): Promise<void> {
  await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

test.describe('TC-CUR-016: base currency survives undo, redo and stale undo', () => {
  let token: string;
  let scope: Scope;
  let priorBaseId: string;
  const currencyIds: string[] = [];
  const rateIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    scope = getTokenContext(token);
    const bases = await listBases(request, token);
    expect(bases.length, 'at most one base currency exists initially').toBeLessThanOrEqual(1);
    if (bases[0]) {
      priorBaseId = bases[0].id;
    } else {
      priorBaseId = (await createCurrency(request, token, scope, true)).id;
    }
    currencyIds.length = 0;
    rateIds.length = 0;
  });

  test.afterEach(async ({ request }) => {
    await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id: priorBaseId, isBase: true } }).catch(() => undefined);
    for (const id of rateIds) await deleteQuietly(request, token, '/api/currencies/exchange-rates', id);
    for (const id of currencyIds) await deleteQuietly(request, token, '/api/currencies/currencies', id);
  });

  test('creating a base currency: undo restores the previous base, redo and undo again keep exactly one', async ({ request }) => {
    const created = await createCurrency(request, token, scope, true);
    currencyIds.push(created.id);
    await expectSingleBase(request, token, created.id, 'new currency is the only base');

    const undoRes = await undo(request, token, created.operation.undoToken);
    expect(undoRes.status(), 'undo create returns 200').toBe(200);
    await expectSingleBase(request, token, priorBaseId, 'previous base is restored after undo');
    expect(await getCurrency(request, token, created.id), 'created currency is gone').toBeFalsy();

    const redoRes = await redo(request, token, created.operation.id);
    expect(redoRes.status(), 'redo create returns 200').toBe(200);
    await expectSingleBase(request, token, created.id, 'redo makes the currency the only base again');

    const undoAgain = await undo(request, token, readOperation(redoRes).undoToken);
    expect(undoAgain.status(), 'undo of the redo returns 200').toBe(200);
    await expectSingleBase(request, token, priorBaseId, 'previous base is restored after undoing the redo');
  });

  test('promoting a currency: undo restores the previous base; a stale undo keeps the newer base', async ({ request }) => {
    const first = await createCurrency(request, token, scope, false);
    const second = await createCurrency(request, token, scope, false);
    currencyIds.push(first.id, second.id);

    const promoteFirst = await promote(request, token, first.id);
    await expectSingleBase(request, token, first.id, 'first is the only base');
    const undoRes = await undo(request, token, promoteFirst.undoToken);
    expect(undoRes.status(), 'undo promotion returns 200').toBe(200);
    await expectSingleBase(request, token, priorBaseId, 'previous base is restored after undoing the promotion');

    const promoteFirstAgain = await promote(request, token, first.id, { name: 'QA TC-CUR-016 renamed' });
    await promote(request, token, second.id);
    await expectSingleBase(request, token, second.id, 'second is the only base');
    const staleUndo = await undo(request, token, promoteFirstAgain.undoToken);
    expect(staleUndo.status(), 'stale undo of the older promotion returns 200').toBe(200);
    await expectSingleBase(request, token, second.id, 'the newer base stays the only base after a stale undo');
    expect((await getCurrency(request, token, first.id))?.name, 'stale undo still restores the other fields').toBe(`QA TC-CUR-016 ${first.code}`);
  });

  test('undo is refused when it would leave the organization without a base currency', async ({ request }) => {
    const anchor = await createCurrency(request, token, scope, true);
    const target = await createCurrency(request, token, scope, false);
    currencyIds.push(anchor.id, target.id);

    const promoteTarget = await promote(request, token, target.id);
    const deleteAnchor = await apiRequest(request, 'DELETE', `/api/currencies/currencies?id=${encodeURIComponent(anchor.id)}`, { token });
    expect(deleteAnchor.status(), 'the demoted anchor can be deleted').toBe(200);

    const undoRes = await undo(request, token, promoteTarget.undoToken);
    expect(undoRes.status(), 'undo is refused with 409').toBe(409);
    await expectSingleBase(request, token, target.id, 'target stays the only base');
  });

  test('clearing the base flag on the base currency is rejected', async ({ request }) => {
    const res = await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id: priorBaseId, isBase: false } });
    expect(res.status(), 'PUT isBase:false on the base returns 400').toBe(400);
    await expectSingleBase(request, token, priorBaseId, 'base is unchanged');
  });

  test('undo of creating a currency is refused while active exchange rates reference it', async ({ request }) => {
    const created = await createCurrency(request, token, scope, false);
    currencyIds.push(created.id);
    const base = await getCurrency(request, token, priorBaseId);
    expect(base, 'prior base is readable').toBeTruthy();
    const rateRes = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
      token,
      data: {
        ...scope,
        fromCurrencyCode: created.code,
        toCurrencyCode: base!.code,
        rate: '1.2345',
        date: new Date().toISOString(),
        source: `tc-cur-016-${Date.now()}`,
      },
    });
    expect(rateRes.status(), 'rate is created').toBe(201);
    rateIds.push(((await rateRes.json()) as { id: string }).id);

    const undoRes = await undo(request, token, created.operation.undoToken);
    expect(undoRes.status(), 'undo create is refused with 409').toBe(409);
    expect(await getCurrency(request, token, created.id), 'currency is still live').toBeTruthy();
  });
});
