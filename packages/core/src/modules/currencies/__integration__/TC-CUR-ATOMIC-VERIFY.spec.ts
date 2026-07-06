import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CUR-ATOMIC-VERIFY: verifies the atomic-write refactor of the currencies
 * module (#2368) — and transitively the generic `makeCrudRoute` atomic
 * entity+custom-field path (#2376) and the `withAtomicFlush` helper (#2343) —
 * is 100% backward-compatible and data-safe.
 *
 * Endpoints covered:
 *   - POST   /api/currencies/currencies                       (create)
 *   - GET    /api/currencies/currencies?code=&isBase=&id=     (read/list)
 *   - PUT    /api/currencies/currencies                       (update)
 *   - DELETE /api/currencies/currencies?id=                   (delete, cleanup)
 *   - POST   /api/audit_logs/audit-logs/actions/undo          (undo)
 *
 * Asserts:
 *   1. Field fidelity (set -> read) for every field the create validator
 *      accepts, then update -> re-read for a representative subset.
 *   2. isBase single-value enforcement survives the atomic refactor
 *      (creating a new base demotes the previous base in one transaction).
 *   3. Undo round-trip for both CREATE (row removed) and UPDATE
 *      (prior field values restored) via the x-om-operation undo token.
 */

type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
  thousandsSeparator: string | null;
  decimalSeparator: string | null;
  isBase: boolean;
  isActive: boolean;
};

const randomCode = generateUniqueCurrencyCode;

function readUndoToken(res: APIResponse): string {
  const header = res.headers()['x-om-operation'] ?? '';
  const enc = header.startsWith('omop:') ? header.slice(5) : '';
  expect(enc, 'x-om-operation header should carry an omop: payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(enc)) as { undoToken?: string };
  expect(typeof payload.undoToken, 'undoToken present in operation payload').toBe('string');
  return payload.undoToken as string;
}

async function getByCode(
  request: APIRequestContext,
  token: string,
  code: string,
): Promise<CurrencyRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/currencies?code=${encodeURIComponent(code)}`, { token });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items?: CurrencyRow[] };
  return (body.items ?? []).find((row) => row.code === code);
}

async function getById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CurrencyRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items?: CurrencyRow[] };
  return (body.items ?? [])[0];
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken },
  });
  expect(res.status(), 'undo returns 200').toBe(200);
  const body = (await res.json()) as { ok?: boolean };
  expect(body.ok, 'undo body is { ok: true }').toBe(true);
}

async function cleanupCurrency(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
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

test.describe('TC-CUR-ATOMIC-VERIFY: atomic refactor is backward-compatible and data-safe', () => {
  test('field fidelity: every create field round-trips, and an update persists', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const code = randomCode();

      const createPayload = {
        organizationId,
        tenantId,
        code,
        name: 'QA Atomic Verify',
        symbol: 'Z',
        decimalPlaces: 3,
        thousandsSeparator: ' ',
        decimalSeparator: ',',
        isBase: false,
        isActive: true,
      };

      const createRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: createPayload,
      });
      expect(createRes.status(), 'create returns 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'create returns an id').toBeTruthy();

      const created = await getByCode(request, token, code);
      expect(created, 'created currency is readable by code').toBeTruthy();
      // Set -> read fidelity for every field the create validator accepts.
      expect(created!.code).toBe(code);
      expect(created!.name).toBe(createPayload.name);
      expect(created!.symbol).toBe(createPayload.symbol);
      expect(created!.decimalPlaces).toBe(createPayload.decimalPlaces);
      expect(created!.thousandsSeparator).toBe(createPayload.thousandsSeparator);
      expect(created!.decimalSeparator).toBe(createPayload.decimalSeparator);
      expect(created!.isBase).toBe(createPayload.isBase);
      expect(created!.isActive).toBe(createPayload.isActive);

      // Update a representative subset and confirm it persists, while untouched
      // fields are preserved (atomic entity+custom-field write must not drop them).
      const updatePayload = {
        id,
        name: 'QA Atomic Verify Updated',
        symbol: '!',
        decimalPlaces: 1,
        isActive: false,
      };
      const updateRes = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token,
        data: updatePayload,
      });
      expect(updateRes.status(), 'update returns 200').toBe(200);

      const updated = await getById(request, token, id);
      expect(updated, 'updated currency is readable by id').toBeTruthy();
      expect(updated!.name).toBe(updatePayload.name);
      expect(updated!.symbol).toBe(updatePayload.symbol);
      expect(updated!.decimalPlaces).toBe(updatePayload.decimalPlaces);
      expect(updated!.isActive).toBe(updatePayload.isActive);
      // Untouched fields preserved.
      expect(updated!.code).toBe(code);
      expect(updated!.thousandsSeparator).toBe(createPayload.thousandsSeparator);
      expect(updated!.decimalSeparator).toBe(createPayload.decimalSeparator);
      expect(updated!.isBase).toBe(false);
    } finally {
      await cleanupCurrency(request, token, id);
    }
  });

  test('isBase enforcement: creating a new base demotes the previous base', async ({ request }) => {
    let token: string | null = null;
    let aId: string | null = null;
    let bId: string | null = null;
    let priorBaseId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      // Capture any pre-existing base so we can restore shared state afterwards.
      const priorBaseRes = await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true', { token });
      expect(priorBaseRes.status()).toBe(200);
      const priorBases = ((await priorBaseRes.json()) as { items?: CurrencyRow[] }).items ?? [];
      // Invariant before we start: at most one base currency.
      expect(priorBases.length, 'at most one base currency exists initially').toBeLessThanOrEqual(1);
      priorBaseId = priorBases[0]?.id ?? null;

      const aRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code: randomCode(), name: 'QA Base A', isBase: true },
      });
      expect(aRes.status(), 'create A as base').toBe(201);
      aId = ((await aRes.json()) as { id: string }).id;

      // A is now the only base; any previous base must be demoted.
      const afterA = ((await (await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true', { token })).json()) as { items?: CurrencyRow[] }).items ?? [];
      expect(afterA.length, 'exactly one base after creating A').toBe(1);
      expect(afterA[0].id, 'A is the single base').toBe(aId);

      const bRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code: randomCode(), name: 'QA Base B', isBase: true },
      });
      expect(bRes.status(), 'create B as base').toBe(201);
      bId = ((await bRes.json()) as { id: string }).id;

      // Creating B as base must demote A within the same transaction.
      expect((await getById(request, token, aId))?.isBase, 'A demoted after B became base').toBe(false);
      expect((await getById(request, token, bId))?.isBase, 'B is the base').toBe(true);
      const afterB = ((await (await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true', { token })).json()) as { items?: CurrencyRow[] }).items ?? [];
      expect(afterB.length, 'still exactly one base after creating B').toBe(1);
    } finally {
      await cleanupCurrency(request, token, aId);
      await cleanupCurrency(request, token, bId);
      // Restore the original base so we leave shared state as we found it.
      if (token && priorBaseId) {
        try {
          await apiRequest(request, 'PUT', '/api/currencies/currencies', { token, data: { id: priorBaseId, isBase: true } });
        } catch {
          /* ignore */
        }
      }
    }
  });

  test('undo round-trip: CREATE undo removes the row, UPDATE undo restores prior values', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    let undone = false;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      // --- UPDATE undo: capture state, mutate, undo, confirm revert ---
      const code = randomCode();
      const createRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: {
          organizationId,
          tenantId,
          code,
          name: 'QA Undo Original',
          symbol: 'O',
          decimalPlaces: 2,
          isActive: true,
        },
      });
      expect(createRes.status(), 'create for update-undo').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;

      const updateRes = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token,
        data: { id, name: 'QA Undo Changed', symbol: 'X', decimalPlaces: 5, isActive: false },
      });
      expect(updateRes.status(), 'update before undo').toBe(200);
      const updateUndoToken = readUndoToken(updateRes);

      const afterUpdate = await getById(request, token, id);
      expect(afterUpdate?.name, 'update applied before undo').toBe('QA Undo Changed');

      await undo(request, token, updateUndoToken);

      const afterUndoUpdate = await getById(request, token, id);
      expect(afterUndoUpdate, 'row still present after update-undo').toBeTruthy();
      expect(afterUndoUpdate!.name, 'name restored').toBe('QA Undo Original');
      expect(afterUndoUpdate!.symbol, 'symbol restored').toBe('O');
      expect(afterUndoUpdate!.decimalPlaces, 'decimalPlaces restored').toBe(2);
      expect(afterUndoUpdate!.isActive, 'isActive restored').toBe(true);

      // --- CREATE undo: undo the original create, confirm row is gone ---
      // Re-create cleanly so the undo token matches the latest create operation.
      await apiRequest(request, 'DELETE', `/api/currencies/currencies?id=${encodeURIComponent(id)}`, { token });
      id = null;

      const createCode = randomCode();
      const createForUndoRes = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code: createCode, name: 'QA Undo Create' },
      });
      expect(createForUndoRes.status(), 'create for create-undo').toBe(201);
      id = ((await createForUndoRes.json()) as { id: string }).id;
      const createUndoToken = readUndoToken(createForUndoRes);

      expect(await getByCode(request, token, createCode), 'currency exists before create-undo').toBeTruthy();

      await undo(request, token, createUndoToken);
      undone = true;
      id = null;

      const listRes = await apiRequest(request, 'GET', `/api/currencies/currencies?code=${encodeURIComponent(createCode)}`, { token });
      expect(listRes.status()).toBe(200);
      const remaining = ((await listRes.json()) as { items?: CurrencyRow[]; total?: number });
      expect((remaining.items ?? []).filter((row) => row.code === createCode).length, 'no rows after create-undo').toBe(0);
    } finally {
      if (!undone) {
        await cleanupCurrency(request, token, id);
      }
    }
  });
});
