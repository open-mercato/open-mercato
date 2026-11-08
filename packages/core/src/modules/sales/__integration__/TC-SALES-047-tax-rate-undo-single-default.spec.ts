import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-047: undoing a tax-rate update or delete keeps a single default tax rate per scope.
 *
 * Create, update and create-redo demote every other default tax rate when a rate becomes the
 * default. Update undo and delete undo restored `isDefault=true` from the snapshot without that
 * step, leaving two defaults; update undo also resurrected a stale `isDefault=true` when the
 * undone update never changed it. Restoring the rate and demoting the other defaults commit in one
 * transaction, so a failed demotion leaves the scope unchanged and the same undo can be retried.
 */
type TaxRateRow = { id: string; name: string; isDefault: boolean; organizationId: string | null }

const COLLECTION = '/api/sales/tax-rates'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function listTaxRates(request: APIRequestContext, token: string): Promise<TaxRateRow[]> {
  const rows: TaxRateRow[] = []
  for (let page = 1; page <= 50; page += 1) {
    const res = await apiRequest(request, 'GET', `${COLLECTION}?page=${page}&pageSize=100&probe=${Date.now()}`, { token })
    expect(res.status(), 'list tax rates').toBe(200)
    const body = await readJsonSafe<{ items?: TaxRateRow[]; totalPages?: number }>(res)
    rows.push(...(body?.items ?? []))
    if (page >= (body?.totalPages ?? 1)) break
  }
  return rows
}

async function createTaxRate(
  request: APIRequestContext,
  token: string,
  stamp: string,
  suffix: string,
  isDefault: boolean,
): Promise<string> {
  const res = await apiRequest(request, 'POST', COLLECTION, {
    token,
    data: { name: `QA Default Undo ${suffix} ${stamp}`, code: `qa-def-undo-${suffix}-${stamp}`, rate: '7.5', isDefault },
  })
  expect(res.status(), `create tax rate ${suffix}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(res)
  expect(body?.id, `tax rate ${suffix} id`).toBeTruthy()
  return body!.id as string
}

async function updateTaxRate(request: APIRequestContext, token: string, data: Record<string, unknown>) {
  const res = await apiRequest(request, 'PUT', COLLECTION, { token, data })
  expect(res.status(), `update tax rate ${String(data.id)}`).toBe(200)
  return res
}

async function expectSingleDefault(
  request: APIRequestContext,
  token: string,
  expectedDefaultId: string,
  otherIds: string[],
) {
  const rows = await listTaxRates(request, token)
  const expected = rows.find((row) => row.id === expectedDefaultId)
  expect(expected?.isDefault, 'expected rate is the default').toBe(true)
  for (const id of otherIds) {
    expect(rows.find((row) => row.id === id)?.isDefault, `rate ${id} is not the default`).toBe(false)
  }
  const defaults = rows.filter((row) => row.isDefault && row.organizationId === expected?.organizationId)
  expect(defaults.map((row) => row.id), 'exactly one default tax rate in scope').toEqual([expectedDefaultId])
}

async function withDefaultRestored(
  request: APIRequestContext,
  token: string,
  run: (created: string[]) => Promise<void>,
) {
  const originalDefaults = (await listTaxRates(request, token)).filter((row) => row.isDefault)
  const created: string[] = []
  try {
    await run(created)
  } finally {
    const createdRows = created.length ? await listTaxRates(request, token).catch(() => []) : []
    const createdOrganizationId = createdRows.find((row) => created.includes(row.id))?.organizationId ?? null
    for (const id of created) {
      await apiRequest(request, 'DELETE', `${COLLECTION}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
    }
    const originalDefault =
      originalDefaults.find((row) => row.organizationId === createdOrganizationId) ?? originalDefaults[0] ?? null
    if (originalDefault) {
      await apiRequest(request, 'PUT', COLLECTION, { token, data: { id: originalDefault.id, isDefault: true } }).catch(
        () => undefined,
      )
    }
  }
}

async function withFailingDemotion(rateId: string, stamp: string, run: () => Promise<void>) {
  if (!UUID_RE.test(rateId)) throw new Error('[internal] Tax rate fixture id is not a UUID')
  const functionName = `om_test_fail_tax_demotion_${stamp}`
  const triggerName = `om_test_fail_tax_demotion_trigger_${stamp}`
  try {
    await withClient(async (client) => {
      await client.query(
        `create function "${functionName}"() returns trigger language plpgsql as $$
         begin
           raise exception 'injected tax rate demotion failure';
         end
         $$`,
      )
      await client.query(
        `create trigger "${triggerName}"
         before update on sales_tax_rates
         for each row when (old.id = '${rateId}'::uuid and old.is_default and not new.is_default)
         execute function "${functionName}"()`,
      )
    })
    await run()
  } finally {
    await withClient(async (client) => {
      await client.query(`drop trigger if exists "${triggerName}" on sales_tax_rates`)
      await client.query(`drop function if exists "${functionName}"()`)
    })
  }
}

test.describe('TC-SALES-047: tax-rate undo keeps a single default', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('undoing the update that cleared the default demotes the newer default', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    await withDefaultRestored(request, token, async (created) => {
      const rateA = await createTaxRate(request, token, stamp, 'a', true)
      created.push(rateA)
      const rateB = await createTaxRate(request, token, stamp, 'b', false)
      created.push(rateB)

      const clearA = expectOperation(await updateTaxRate(request, token, { id: rateA, isDefault: false }), 'clear default A')
      await updateTaxRate(request, token, { id: rateB, isDefault: true })
      await expectSingleDefault(request, token, rateB, [rateA])

      await undoOk(request, token, clearA.undoToken, 'undo clear default A')
      await expectSingleDefault(request, token, rateA, [rateB])
    })
  })

  test('undoing the delete of the default demotes the newer default', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    await withDefaultRestored(request, token, async (created) => {
      const rateA = await createTaxRate(request, token, stamp, 'a', true)
      created.push(rateA)
      const rateB = await createTaxRate(request, token, stamp, 'b', false)
      created.push(rateB)

      const deleteRes = await apiRequest(request, 'DELETE', `${COLLECTION}?id=${encodeURIComponent(rateA)}`, { token })
      expect(deleteRes.status(), 'delete A').toBe(200)
      const deleteA = expectOperation(deleteRes, 'delete A')
      await updateTaxRate(request, token, { id: rateB, isDefault: true })
      const beforeUndo = await listTaxRates(request, token)
      expect(beforeUndo.some((row) => row.id === rateA), 'A is deleted').toBe(false)
      expect(beforeUndo.find((row) => row.id === rateB)?.isDefault, 'B is the default').toBe(true)

      await undoOk(request, token, deleteA.undoToken, 'undo delete A')
      await expectSingleDefault(request, token, rateA, [rateB])
    })
  })

  test('undoing an edit that did not touch isDefault keeps the newer default', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    await withDefaultRestored(request, token, async (created) => {
      const rateA = await createTaxRate(request, token, stamp, 'a', true)
      created.push(rateA)
      const rateB = await createTaxRate(request, token, stamp, 'b', false)
      created.push(rateB)

      const renameA = expectOperation(
        await updateTaxRate(request, token, { id: rateA, name: `QA Default Undo renamed ${stamp}` }),
        'rename A',
      )
      await updateTaxRate(request, token, { id: rateB, isDefault: true })
      await expectSingleDefault(request, token, rateB, [rateA])

      await undoOk(request, token, renameA.undoToken, 'undo rename A')
      const rows = await listTaxRates(request, token)
      expect(rows.find((row) => row.id === rateA)?.name, 'rename undone').toBe(`QA Default Undo a ${stamp}`)
      await expectSingleDefault(request, token, rateB, [rateA])
    })
  })

  test('a failed demotion rolls back the restored default and the update undo can be retried', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    await withDefaultRestored(request, token, async (created) => {
      const rateA = await createTaxRate(request, token, stamp, 'a', true)
      created.push(rateA)
      const rateB = await createTaxRate(request, token, stamp, 'b', false)
      created.push(rateB)

      const clearA = expectOperation(await updateTaxRate(request, token, { id: rateA, isDefault: false }), 'clear default A')
      await updateTaxRate(request, token, { id: rateB, isDefault: true })

      await withFailingDemotion(rateB, stamp, async () => {
        const failed = await undoByToken(request, token, clearA.undoToken)
        expect(failed.ok(), 'injected demotion failure rejects the undo').toBe(false)
        await expectSingleDefault(request, token, rateB, [rateA])
      })

      await undoOk(request, token, clearA.undoToken, 'retry undo clear default A')
      await expectSingleDefault(request, token, rateA, [rateB])
    })
  })

  test('a failed demotion rolls back the recreated default and the delete undo can be retried', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    await withDefaultRestored(request, token, async (created) => {
      const rateA = await createTaxRate(request, token, stamp, 'a', true)
      created.push(rateA)
      const rateB = await createTaxRate(request, token, stamp, 'b', false)
      created.push(rateB)

      const deleteRes = await apiRequest(request, 'DELETE', `${COLLECTION}?id=${encodeURIComponent(rateA)}`, { token })
      expect(deleteRes.status(), 'delete A').toBe(200)
      const deleteA = expectOperation(deleteRes, 'delete A')
      await updateTaxRate(request, token, { id: rateB, isDefault: true })

      await withFailingDemotion(rateB, stamp, async () => {
        const failed = await undoByToken(request, token, deleteA.undoToken)
        expect(failed.ok(), 'injected demotion failure rejects the undo').toBe(false)
        const rows = await listTaxRates(request, token)
        expect(rows.some((row) => row.id === rateA), 'A stays deleted').toBe(false)
        expect(rows.find((row) => row.id === rateB)?.isDefault, 'B stays the default').toBe(true)
      })

      await undoOk(request, token, deleteA.undoToken, 'retry undo delete A')
      await expectSingleDefault(request, token, rateA, [rateB])
    })
  })
})
