import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  withClient,
  type IntegrationDbClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-7336 — invoice custom fields and stale-checked undo (Phase 1 of
 * `.ai/specs/2026-11-06-sales-invoice-import-write-path.md`).
 *
 * Invoice create and update used to drop custom fields, and their undo overwrote
 * newer data or reported success on a deleted invoice. A change "by another
 * actor" is written straight to the database, so the undo route's same-actor
 * token check does not hide the handler's own stale check.
 */

const INVOICES = '/api/sales/invoices'
const DEFINITIONS = '/api/entities/definitions'
const INVOICE_ENTITY = 'sales:sales_invoice'

type JsonMap = Record<string, unknown>

async function createDefinition(
  request: APIRequestContext,
  token: string,
  key: string,
  definition: JsonMap = { kind: 'text' },
): Promise<void> {
  const response = await apiRequest(request, 'POST', DEFINITIONS, {
    token,
    data: { entityId: INVOICE_ENTITY, key, label: key, formEditable: true, listVisible: true, ...definition },
  })
  expect(response.ok(), `custom field definition create failed (${response.status()})`).toBeTruthy()
}

/** Best-effort cleanup that reports a failed delete without masking the test's own error. */
async function deleteDefinition(request: APIRequestContext, token: string, key: string): Promise<void> {
  try {
    const response = await apiRequest(request, 'DELETE', DEFINITIONS, { token, data: { entityId: INVOICE_ENTITY, key } })
    if (!response.ok()) console.warn(`[TC-SALES-7336] custom field definition ${key} delete failed (${response.status()})`)
  } catch (err) {
    console.warn(`[TC-SALES-7336] custom field definition ${key} delete failed`, err)
  }
}

async function readScope(client: IntegrationDbClient, invoiceId: string) {
  const result = await client.query<{ organization_id: string; tenant_id: string }>(
    'select organization_id, tenant_id from sales_invoices where id = $1',
    [invoiceId],
  )
  return result.rows[0]
}

/**
 * Polls, from the connection that holds the lock, until `expected` other backends
 * wait on it, directly or behind another waiter, so a test proves the requests
 * really contended instead of trusting a fixed sleep. Waiters on unrelated locks
 * from parallel workers are not counted.
 */
async function waitForLockWaiters(client: IntegrationDbClient, expected: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await client.query<{ waiting: string }>(
      `with direct as (
         select pid from pg_stat_activity
          where datname = current_database() and pg_blocking_pids(pid) && array[pg_backend_pid()]
       )
       select count(*)::text as waiting from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and pg_blocking_pids(pid) && (array[pg_backend_pid()] || array(select pid from direct))`,
    )
    if (Number(result.rows[0]?.waiting ?? 0) >= expected) return
    if (Date.now() > deadline) throw new Error(`expected ${expected} lock waiter(s) within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Inserts a payment and an allocation to the invoice, as another actor would, on `client`. */
async function insertAllocation(client: IntegrationDbClient, invoiceId: string): Promise<void> {
  const scope = await readScope(client, invoiceId)
  const payment = await client.query<{ id: string }>(
    `insert into sales_payments (id, organization_id, tenant_id, currency_code, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, 'EUR', now(), now()) returning id`,
    [scope.organization_id, scope.tenant_id],
  )
  await client.query(
    `insert into sales_payment_allocations (id, payment_id, invoice_id, organization_id, tenant_id, currency_code)
     values (gen_random_uuid(), $1, $2, $3, $4, 'EUR')`,
    [payment.rows[0].id, invoiceId, scope.organization_id, scope.tenant_id],
  )
}

async function allocationCount(invoiceId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from sales_payment_allocations where invoice_id = $1',
      [invoiceId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function readInvoice(request: APIRequestContext, token: string, id: string): Promise<JsonMap | undefined> {
  const response = await apiRequest(request, 'GET', `${INVOICES}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/sales/invoices should be 200').toBe(200)
  const body = await readJsonSafe<{ items?: JsonMap[] }>(response)
  return body?.items?.find((item) => item.id === id)
}

async function createInvoice(request: APIRequestContext, token: string, data: JsonMap) {
  const response = await apiRequest(request, 'POST', INVOICES, {
    token,
    data: {
      currencyCode: 'EUR',
      lines: [{ quantity: 1, currencyCode: 'EUR', totalNetAmount: 100, totalGrossAmount: 123 }],
      subtotalNetAmount: 100,
      subtotalGrossAmount: 123,
      taxTotalAmount: 23,
      grandTotalNetAmount: 100,
      grandTotalGrossAmount: 123,
      ...data,
    },
  })
  expect(response.status(), 'POST /api/sales/invoices should be 201').toBe(201)
  const body = await readJsonSafe<{ invoiceId?: string; id?: string }>(response)
  const invoiceId = body?.invoiceId ?? body?.id ?? null
  expect(typeof invoiceId, 'invoice create should return an id').toBe('string')
  return { invoiceId: invoiceId as string, operation: expectOperation(response, 'invoice create') }
}

async function updateInvoice(request: APIRequestContext, token: string, data: JsonMap) {
  const response = await apiRequest(request, 'PUT', INVOICES, { token, data })
  expect(response.status(), 'PUT /api/sales/invoices should be 200').toBe(200)
  return expectOperation(response, 'invoice update')
}

async function reorderSchedule(invoiceId: string): Promise<void> {
  await withClient((client) =>
    client.query(`update sales_invoices set metadata = '{"schedule":["balance","deposit"]}'::jsonb where id = $1`, [invoiceId]),
  )
}

async function readSchedule(invoiceId: string): Promise<unknown> {
  return withClient(async (client) => {
    const result = await client.query<{ metadata: { schedule?: unknown } | null }>(
      'select metadata from sales_invoices where id = $1 and deleted_at is null',
      [invoiceId],
    )
    return result.rows[0]?.metadata?.schedule ?? null
  })
}

async function purgeInvoice(invoiceId: string | null): Promise<void> {
  if (!invoiceId) return
  await withClient(async (client) => {
    await client.query('delete from sales_notes where context_id = $1', [invoiceId])
    const payments = await client.query<{ payment_id: string }>(
      'select payment_id from sales_payment_allocations where invoice_id = $1',
      [invoiceId],
    )
    await client.query('delete from sales_payment_allocations where invoice_id = $1', [invoiceId])
    for (const row of payments.rows) await client.query('delete from sales_payments where id = $1', [row.payment_id])
    await client.query('delete from sales_credit_memos where invoice_id = $1', [invoiceId])
    await client.query('delete from sales_invoice_lines where invoice_id = $1', [invoiceId])
    await client.query('delete from custom_field_values where record_id = $1', [invoiceId])
    await client.query('delete from sales_invoices where id = $1', [invoiceId])
  })
}

test.describe('TC-SALES-7336: invoice custom fields and undo', () => {
  test('stores custom fields on create and update, and undo restores them and clears an added one', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const company = `inv_company_${stamp}`
    const extra = `inv_extra_${stamp}`
    let invoiceId: string | null = null
    try {
      await createDefinition(request, token, company)
      await createDefinition(request, token, extra)

      const created = await createInvoice(request, token, { [`cf_${company}`]: 'company-1' })
      invoiceId = created.invoiceId
      expect((await readInvoice(request, token, invoiceId))?.[`cf_${company}`]).toBe('company-1')

      const update = await updateInvoice(request, token, {
        id: invoiceId,
        taxTotalAmount: 24,
        customFields: { [company]: 'company-2', [extra]: 'added' },
      })
      const updated = await readInvoice(request, token, invoiceId)
      expect(updated?.[`cf_${company}`]).toBe('company-2')
      expect(updated?.[`cf_${extra}`]).toBe('added')
      expect(Number(updated?.taxTotalAmount ?? updated?.tax_total_amount)).toBe(24)

      const undo = await undoByToken(request, token, update.undoToken)
      expect(undo.status(), 'undo of an unchanged update should succeed').toBe(200)
      const restored = await readInvoice(request, token, invoiceId)
      expect(restored?.[`cf_${company}`]).toBe('company-1')
      expect(restored?.[`cf_${extra}`] ?? null, 'the field the update added must be cleared').toBeNull()
      expect(Number(restored?.taxTotalAmount ?? restored?.tax_total_amount)).toBe(23)
    } finally {
      await purgeInvoice(invoiceId)
      await deleteDefinition(request, token, company)
      await deleteDefinition(request, token, extra)
    }
  })

  test('undoes an update that cleared a scalar and a multi-value custom field', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const scalar = `inv_scalar_${stamp}`
    const multi = `inv_multi_${stamp}`
    let invoiceId: string | null = null
    try {
      await createDefinition(request, token, scalar)
      await createDefinition(request, token, multi, {
        kind: 'select',
        configJson: { label: multi, multi: true, options: ['alpha', 'beta'] },
      })

      const created = await createInvoice(request, token, {
        customFields: { [scalar]: 'kept', [multi]: ['alpha', 'beta'] },
      })
      invoiceId = created.invoiceId
      const update = await updateInvoice(request, token, {
        id: invoiceId,
        customFields: { [scalar]: null, [multi]: [] },
      })
      const cleared = await readInvoice(request, token, invoiceId)
      expect(cleared?.[`cf_${scalar}`] ?? null).toBeNull()

      const undo = await undoByToken(request, token, update.undoToken)
      expect(undo.status(), 'a cleared field reads back empty and must not make the undo stale').toBe(200)
      const restored = await readInvoice(request, token, invoiceId)
      expect(restored?.[`cf_${scalar}`]).toBe('kept')
      expect([...((restored?.[`cf_${multi}`] as string[] | undefined) ?? [])].sort()).toEqual(['alpha', 'beta'])
    } finally {
      await purgeInvoice(invoiceId)
      await deleteDefinition(request, token, scalar)
      await deleteDefinition(request, token, multi)
    }
  })

  test('sanitizes rich-text custom field values on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const field = `inv_rich_${Date.now()}`
    let invoiceId: string | null = null
    try {
      await createDefinition(request, token, field, { kind: 'multiline', configJson: { editor: 'htmlRichText' } })

      const created = await createInvoice(request, token, {
        [`cf_${field}`]: '<p>Created</p><script>window.createdPayload = 1</script>',
      })
      invoiceId = created.invoiceId
      const afterCreate = String((await readInvoice(request, token, invoiceId))?.[`cf_${field}`] ?? '')
      expect(afterCreate).toContain('<p>Created</p>')
      expect(afterCreate).not.toContain('<script')

      await updateInvoice(request, token, {
        id: invoiceId,
        customFields: { [field]: '<p>Updated</p><img src="x" onerror="window.updatedPayload = 1">' },
      })
      const afterUpdate = String((await readInvoice(request, token, invoiceId))?.[`cf_${field}`] ?? '')
      expect(afterUpdate).toContain('<p>Updated</p>')
      expect(afterUpdate).not.toContain('onerror')
    } finally {
      await purgeInvoice(invoiceId)
      await deleteDefinition(request, token, field)
    }
  })

  test('answers 404 for an update of a missing invoice', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'PUT', INVOICES, {
      token,
      data: { id: '00000000-0000-4000-8000-000000000000', invoiceNumber: 'missing' },
    })
    expect(response.status()).toBe(404)
  })

  test('refuses an update undo with 409 after another actor changed the invoice', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      ;({ invoiceId } = await createInvoice(request, token, {}))
      const update = await updateInvoice(request, token, { id: invoiceId, invoiceNumber: `INV-7336-${Date.now()}` })
      await withClient((client) =>
        client.query("update sales_invoices set grand_total_gross_amount = '999' where id = $1", [invoiceId]),
      )

      const undo = await undoByToken(request, token, update.undoToken)
      expect(undo.status(), 'a stale invoice undo must be refused').toBe(409)
      const body = await readJsonSafe<{ error?: string }>(undo)
      expect(body?.error).toContain('invoice was changed afterwards')
      const current = await readInvoice(request, token, invoiceId)
      expect(Number(current?.grandTotalGrossAmount ?? current?.grand_total_gross_amount)).toBe(999)
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('refuses an update undo with 409 after another actor reordered an array in the invoice metadata', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      ;({ invoiceId } = await createInvoice(request, token, { metadata: { schedule: ['deposit', 'balance'] } }))
      const update = await updateInvoice(request, token, { id: invoiceId, invoiceNumber: `INV-7336-${Date.now()}` })
      await reorderSchedule(invoiceId)

      const undo = await undoByToken(request, token, update.undoToken)
      expect(undo.status(), 'a reordered metadata array is a later change').toBe(409)
      expect(await readSchedule(invoiceId)).toEqual(['balance', 'deposit'])
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('refuses a create undo with 409 after another actor reordered an array in the invoice metadata', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      const created = await createInvoice(request, token, { metadata: { schedule: ['deposit', 'balance'] } })
      invoiceId = created.invoiceId
      await reorderSchedule(invoiceId)

      const undo = await undoByToken(request, token, created.operation.undoToken)
      expect(undo.status(), 'create undo must not delete an invoice whose metadata was reordered').toBe(409)
      expect(await readSchedule(invoiceId)).toEqual(['balance', 'deposit'])
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('refuses the older undo while the same actor has a later update, then undoes both in reverse order', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      ;({ invoiceId } = await createInvoice(request, token, { invoiceNumber: `INV-7336-A-${Date.now()}` }))
      const first = await updateInvoice(request, token, { id: invoiceId, taxTotalAmount: 30 })
      const second = await updateInvoice(request, token, { id: invoiceId, taxTotalAmount: 40 })

      const early = await undoByToken(request, token, first.undoToken)
      expect(early.status(), 'the undo route refuses an older token first').toBe(400)

      expect((await undoByToken(request, token, second.undoToken)).status()).toBe(200)
      expect((await undoByToken(request, token, first.undoToken)).status()).toBe(200)
      const current = await readInvoice(request, token, invoiceId)
      expect(Number(current?.taxTotalAmount ?? current?.tax_total_amount)).toBe(23)
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('undoes an untouched create and removes its lines and custom-field rows', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const field = `inv_undo_${Date.now()}`
    let invoiceId: string | null = null
    try {
      await createDefinition(request, token, field)
      const created = await createInvoice(request, token, { customFields: { [field]: 'value' } })
      invoiceId = created.invoiceId
      const undo = await undoByToken(request, token, created.operation.undoToken)
      expect(undo.status(), 'undo of an untouched create should succeed').toBe(200)
      expect(await readInvoice(request, token, invoiceId)).toBeUndefined()
      const remaining = await withClient(async (client) => {
        const result = await client.query<{ invoices: string; lines: string; values: string }>(
          `select (select count(*) from sales_invoices where id = $1)::text as invoices,
                  (select count(*) from sales_invoice_lines where invoice_id = $1)::text as lines,
                  (select count(*) from custom_field_values where record_id = $1::text)::text as values`,
          [invoiceId],
        )
        return result.rows[0]
      })
      expect(Number(remaining?.invoices)).toBe(0)
      expect(Number(remaining?.lines)).toBe(0)
      expect(Number(remaining?.values), 'create undo must not leave custom-field rows behind').toBe(0)
    } finally {
      await purgeInvoice(invoiceId)
      await deleteDefinition(request, token, field)
    }
  })

  test('refuses a create undo with 409 when a note was written for the invoice by another actor', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      const created = await createInvoice(request, token, {})
      invoiceId = created.invoiceId
      await withClient(async (client) => {
        const scope = await client.query<{ organization_id: string; tenant_id: string }>(
          'select organization_id, tenant_id from sales_invoices where id = $1',
          [invoiceId],
        )
        const row = scope.rows[0]
        await client.query(
          `insert into sales_notes (id, organization_id, tenant_id, context_type, context_id, body, created_at, updated_at)
           values (gen_random_uuid(), $1, $2, 'invoice', $3, 'TC-SALES-7336 foreign note', now(), now())`,
          [row.organization_id, row.tenant_id, invoiceId],
        )
      })

      const undo = await undoByToken(request, token, created.operation.undoToken)
      expect(undo.status(), 'create undo must not strand a note').toBe(409)
      expect(await readInvoice(request, token, invoiceId)).toBeTruthy()
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('answers 404 and changes nothing for an invoice that sits in another organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    let otherOrganizationId: string | null = null
    try {
      ;({ invoiceId } = await createInvoice(request, token, { invoiceNumber: `INV-7336-ORG-${Date.now()}` }))
      const scope = await withClient((client) => readScope(client, invoiceId as string))
      otherOrganizationId = await createOrganizationInDb({ name: `TC-SALES-7336 ${Date.now()}`, tenantId: scope.tenant_id })
      await withClient((client) =>
        client.query('update sales_invoices set organization_id = $1 where id = $2', [otherOrganizationId, invoiceId]),
      )

      const response = await apiRequest(request, 'PUT', INVOICES, {
        token,
        data: { id: invoiceId, invoiceNumber: 'must-not-apply' },
      })
      expect(response.status(), 'an invoice outside the request organization is not found').toBe(404)
      const stored = await withClient(async (client) => {
        const result = await client.query<{ invoice_number: string }>(
          'select invoice_number from sales_invoices where id = $1',
          [invoiceId],
        )
        return result.rows[0]?.invoice_number
      })
      expect(stored).not.toBe('must-not-apply')
    } finally {
      await purgeInvoice(invoiceId)
      await deleteOrganizationInDb(otherOrganizationId)
    }
  })

  test('refuses a create undo with 409 when a payment allocation or a soft-deleted credit memo references the invoice', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let allocatedId: string | null = null
    let creditedId: string | null = null
    try {
      const allocated = await createInvoice(request, token, {})
      allocatedId = allocated.invoiceId
      await withClient((client) => insertAllocation(client, allocated.invoiceId))
      const allocationUndo = await undoByToken(request, token, allocated.operation.undoToken)
      expect(allocationUndo.status(), 'create undo must not unlink an allocation').toBe(409)
      expect(await allocationCount(allocated.invoiceId)).toBe(1)

      const credited = await createInvoice(request, token, {})
      creditedId = credited.invoiceId
      await withClient(async (client) => {
        const scope = await readScope(client, credited.invoiceId)
        await client.query(
          `insert into sales_credit_memos (id, organization_id, tenant_id, invoice_id, credit_memo_number, currency_code, deleted_at, created_at, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, 'EUR', now(), now(), now())`,
          [scope.organization_id, scope.tenant_id, credited.invoiceId, `CM-7336-${Date.now()}`],
        )
      })
      const creditUndo = await undoByToken(request, token, credited.operation.undoToken)
      expect(creditUndo.status(), 'create undo must not unlink a soft-deleted credit memo').toBe(409)
      expect(await readInvoice(request, token, credited.invoiceId)).toBeTruthy()
    } finally {
      await purgeInvoice(allocatedId)
      await purgeInvoice(creditedId)
    }
  })

  test('a create undo that waits on an allocation insert in flight refuses with 409 once it commits', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      const created = await createInvoice(request, token, {})
      invoiceId = created.invoiceId
      const undoStatus = await withClient(async (client) => {
        await client.query('begin')
        // The foreign-key insert holds KEY SHARE on the invoice row until commit,
        // which blocks the undo's FOR UPDATE lock.
        await insertAllocation(client, created.invoiceId)
        const undo = undoByToken(request, token, created.operation.undoToken)
        await waitForLockWaiters(client, 1)
        await client.query('commit')
        return (await undo).status()
      })
      expect(undoStatus, 'the undo must see the allocation committed while it waited').toBe(409)
      expect(await allocationCount(created.invoiceId)).toBe(1)
      expect(await readInvoice(request, token, created.invoiceId)).toBeTruthy()
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('rolls the whole invoice back when its custom fields cannot be stored', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const invoiceNumber = `INV-7336-RB-${Date.now()}`
    // More than MAX_CUSTOM_FIELD_KEYS_PER_RECORD (128) keys fails the write after
    // the header and lines were flushed in the same transaction.
    const tooManyFields = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`cf_rb_${index}`, 'x']))
    try {
      const response = await apiRequest(request, 'POST', INVOICES, {
        token,
        data: {
          currencyCode: 'EUR',
          invoiceNumber,
          lines: [{ quantity: 1, currencyCode: 'EUR', totalNetAmount: 1, totalGrossAmount: 1 }],
          ...tooManyFields,
        },
      })
      expect(response.ok(), 'an unstorable custom-field set must fail the create').toBeFalsy()
      const stored = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          'select count(*)::text as count from sales_invoices where invoice_number = $1',
          [invoiceNumber],
        )
        return Number(result.rows[0]?.count ?? 0)
      })
      expect(stored, 'no invoice row may survive the failed write').toBe(0)
    } finally {
      const leftovers = await withClient(async (client) => {
        const result = await client.query<{ id: string }>('select id from sales_invoices where invoice_number = $1', [
          invoiceNumber,
        ])
        return result.rows.map((row) => row.id)
      })
      for (const id of leftovers) await purgeInvoice(id)
    }
  })
})
