/** @jest-environment node */

/**
 * Invoice write path for imported invoices (#7336,
 * `.ai/specs/2026-11-06-sales-invoice-import-write-path.md`).
 *
 * Covers custom fields on create and update, the row-locked phased update, line
 * replacement, and the stale-checked undo of create and update. The database is
 * replaced by a small in-memory EntityManager fake that keeps one invoice, its
 * lines and its custom-field values, and rolls them back when a transaction
 * fails, so atomicity is observable.
 */

import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { E } from '#generated/entities.ids.generated'
import { SalesCreditMemo, SalesInvoice, SalesInvoiceLine, SalesNote, SalesPaymentAllocation } from '../../data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return { ...actual, invalidateCrudCache: jest.fn(async () => undefined) }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    (em: { findOne: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, options: unknown) =>
      em.findOne(entity, where, options),
  ),
  findWithDecryption: jest.fn(
    (em: { find: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, options: unknown) =>
      em.find(entity, where, options),
  ),
}))

const lockMock = jest.fn(async (..._args: unknown[]) => true)

jest.mock('../shared', () => {
  const actual = jest.requireActual('../shared')
  return { ...actual, lockSalesDocumentRow: (...args: unknown[]) => lockMock(...args) }
})

type CustomFieldStore = Map<string, Record<string, unknown>>
const customFieldStore: CustomFieldStore = new Map()
let failNextCustomFieldWrite = false
const setRecordCustomFieldsMock = jest.fn(
  async (_em: unknown, options: { recordId: string; values: Record<string, unknown> }) => {
    if (failNextCustomFieldWrite) {
      failNextCustomFieldWrite = false
      throw new Error('custom field value cannot be stored')
    }
    const current = { ...(customFieldStore.get(options.recordId) ?? {}) }
    for (const [key, value] of Object.entries(options.values)) current[key] = value
    customFieldStore.set(options.recordId, current)
  },
)

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/entities/lib/helpers')
  return {
    ...actual,
    setRecordCustomFields: (...args: unknown[]) =>
      setRecordCustomFieldsMock(...(args as Parameters<typeof setRecordCustomFieldsMock>)),
  }
})

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/custom-fields')
  return {
    ...actual,
    loadCustomFieldValues: jest.fn(async ({ recordIds }: { recordIds: string[] }) => {
      const out: Record<string, Record<string, unknown>> = {}
      for (const id of recordIds) {
        const stored = customFieldStore.get(id)
        if (!stored) continue
        out[id] = Object.fromEntries(Object.entries(stored).map(([key, value]) => [`cf_${key}`, value]))
      }
      return out
    }),
  }
})

const sanitizeMock = jest.fn(async (_em: unknown, opts: { values: Record<string, unknown> }) =>
  Object.fromEntries(
    Object.entries(opts.values).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(/<script>.*?<\/script>/g, '') : value,
    ]),
  ),
)

jest.mock('@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer', () => ({
  sanitizeCustomFieldHtmlRichTextValuesServer: (...args: unknown[]) =>
    sanitizeMock(...(args as Parameters<typeof sanitizeMock>)),
}))

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG_ID = '55555555-5555-4555-8555-555555555555'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const INVOICE_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'

type Row = Record<string, unknown>

type FakeState = {
  invoice: SalesInvoice | null
  lines: Row[]
  dependants: { allocations: number; creditMemos: number; notes: number }
}

function makeInvoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return Object.assign(new SalesInvoice(), {
    id: INVOICE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    invoiceNumber: 'INV-1',
    orderId: null,
    statusEntryId: null,
    status: null,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    dueDate: null,
    currencyCode: 'EUR',
    subtotalNetAmount: '100',
    subtotalGrossAmount: '123',
    discountTotalAmount: '0',
    taxTotalAmount: '23',
    grandTotalNetAmount: '100',
    grandTotalGrossAmount: '123',
    paidTotalAmount: '0',
    outstandingAmount: '123',
    metadata: null,
    customFieldSetId: null,
    deletedAt: null,
    ...overrides,
  })
}

function makeLine(overrides: Row = {}): Row {
  return {
    id: LINE_ID,
    invoice: INVOICE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    lineNumber: 1,
    kind: 'product',
    name: 'Widget',
    sku: null,
    description: null,
    quantity: '1',
    quantityUnit: null,
    normalizedQuantity: '1',
    normalizedUnit: null,
    uomSnapshot: null,
    currencyCode: 'EUR',
    unitPriceNet: '100',
    unitPriceGross: '123',
    discountAmount: '0',
    discountPercent: '0',
    taxRate: '23',
    taxAmount: '23',
    totalNetAmount: '100',
    totalGrossAmount: '123',
    metadata: null,
    ...overrides,
  }
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'invoice') {
      const toId = (ref: unknown) => (typeof ref === 'string' ? ref : (ref as { id?: string } | undefined)?.id)
      return toId(row.invoice) === toId(value)
    }
    return row[key] === value
  })
}

function makeFakeEm(state: FakeState) {
  let pending: Row[] = []
  let savepoint: { invoice: Row | null; invoiceRef: SalesInvoice | null; lines: Row[]; cf: CustomFieldStore } | null = null
  const calls = { lineDeletes: 0, invoiceDeletes: 0, commits: 0, rollbacks: 0 }

  const em = {
    calls,
    fork: () => em,
    begin: jest.fn(async () => {
      savepoint = {
        invoice: state.invoice ? { ...state.invoice } : null,
        invoiceRef: state.invoice,
        lines: state.lines.map((line) => ({ ...line })),
        cf: new Map(Array.from(customFieldStore.entries()).map(([id, values]) => [id, { ...values }])),
      }
    }),
    commit: jest.fn(async () => {
      calls.commits += 1
      savepoint = null
    }),
    rollback: jest.fn(async () => {
      calls.rollbacks += 1
      if (!savepoint) return
      state.invoice = savepoint.invoiceRef
      if (state.invoice && savepoint.invoice) Object.assign(state.invoice, savepoint.invoice)
      state.lines = savepoint.lines
      customFieldStore.clear()
      for (const [id, values] of savepoint.cf) customFieldStore.set(id, values)
      pending = []
      savepoint = null
    }),
    transactional: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      await em.begin()
      try {
        const result = await cb(em)
        await em.commit()
        return result
      } catch (err) {
        await em.rollback()
        throw err
      }
    },
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity !== SalesInvoice || !state.invoice) return null
      const invoice = state.invoice as unknown as Row
      const filter = { ...where }
      if (filter.deletedAt === null && invoice.deletedAt) return null
      delete filter.deletedAt
      return matchesWhere(invoice, filter) ? state.invoice : null
    }),
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity !== SalesInvoiceLine) return []
      return state.lines.filter((line) => matchesWhere(line, where))
    }),
    count: jest.fn(async (entity: unknown) => {
      if (entity === SalesPaymentAllocation) return state.dependants.allocations
      if (entity === SalesCreditMemo) return state.dependants.creditMemos
      if (entity === SalesNote) return state.dependants.notes
      return 0
    }),
    create: jest.fn((entity: unknown, data: Row) => {
      if (entity === SalesInvoice) return Object.assign(new SalesInvoice(), data)
      return { __entity: entity, ...data }
    }),
    persist: jest.fn((entity: Row) => {
      if (entity instanceof SalesInvoice) {
        state.invoice = entity
        return
      }
      pending.push(entity)
    }),
    nativeDelete: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === SalesInvoiceLine) {
        calls.lineDeletes += 1
        state.lines = state.lines.filter((line) => !matchesWhere(line, { invoice: where.invoice }))
      }
      if (entity === SalesInvoice) {
        calls.invoiceDeletes += 1
        state.invoice = null
      }
      if (entity === CustomFieldValue && typeof where.recordId === 'string') {
        customFieldStore.delete(where.recordId)
      }
      return 1
    }),
    flush: jest.fn(async () => {
      for (const entity of pending) {
        const { __entity: _ignored, ...row } = entity
        state.lines.push(row)
      }
      pending = []
    }),
    clear: jest.fn(),
  }
  return em
}

function makeCtx(em: unknown, overrides: Partial<CommandRuntimeContext> = {}) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const markOrmEntityChange = jest.fn()
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange }),
    salesDocumentNumberGenerator: asValue({ generate: async () => ({ number: 'INV-GEN' }) }),
  })
  const ctx: CommandRuntimeContext = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
    ...overrides,
  }
  return { ctx, markOrmEntityChange }
}

function handler<TInput = Row, TResult = { invoiceId: string }>(id: string): CommandHandler<TInput, TResult> {
  const found = commandRegistry.get<TInput, TResult>(id)
  if (!found) throw new Error(`[internal] ${id} was not registered`)
  return found
}

/** Runs update the way the command bus does: execute, captureAfter, buildLog. */
async function runUpdate(input: Row, ctx: CommandRuntimeContext) {
  const update = handler('sales.invoices.update')
  const prepared = (await update.prepare?.(input as never, ctx)) ?? {}
  const result = await update.execute(input as never, ctx)
  const after = await update.captureAfter?.(input as never, result, ctx)
  const log = await update.buildLog?.({
    input: input as never,
    result,
    ctx,
    snapshots: { before: (prepared as Row).before, after },
  })
  return { result, log }
}

/** The action log stores the undo payload as JSON, so dates come back as strings. */
async function runUndo(commandId: string, undo: unknown, ctx: CommandRuntimeContext) {
  await handler(commandId).undo?.({
    logEntry: { commandPayload: { undo: JSON.parse(JSON.stringify(undo)) } },
    ctx,
    input: {},
  } as never)
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toMatchObject({ status })
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    invoice: makeInvoice(),
    lines: [makeLine()],
    dependants: { allocations: 0, creditMemos: 0, notes: 0 },
    ...overrides,
  }
}

const updateScope = { id: INVOICE_ID, organizationId: ORG_ID, tenantId: TENANT_ID }

describe('sales invoice write path (#7336)', () => {
  beforeAll(async () => {
    commandRegistry.clear()
    await import('../documents')
  })

  beforeEach(() => {
    customFieldStore.clear()
    failNextCustomFieldWrite = false
    lockMock.mockReset()
    lockMock.mockResolvedValue(true)
    setRecordCustomFieldsMock.mockClear()
    sanitizeMock.mockClear()
  })

  describe('create', () => {
    it('stores custom fields without a customFieldSetId, sanitized, in the same transaction', async () => {
      const state = baseState({ invoice: null, lines: [] })
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em)

      const { invoiceId } = await handler('sales.invoices.create').execute(
        {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          currencyCode: 'EUR',
          customFields: { xero_company_id: 'company-1', note: 'ok<script>x</script>' },
          lines: [{ quantity: 1, currencyCode: 'EUR', totalNetAmount: 100, totalGrossAmount: 123 }],
        } as never,
        ctx,
      )

      expect(sanitizeMock).toHaveBeenCalledTimes(1)
      expect(customFieldStore.get(invoiceId)).toEqual({ xero_company_id: 'company-1', note: 'ok' })
      expect(state.lines).toHaveLength(1)
      expect(em.calls.commits).toBe(1)
    })

    it('captures the after snapshot inside the transaction, not after commit', async () => {
      const state = baseState({ invoice: null, lines: [] })
      const { ctx } = makeCtx(makeFakeEm(state))
      const create = handler('sales.invoices.create')
      const input = { organizationId: ORG_ID, tenantId: TENANT_ID, currencyCode: 'EUR', grandTotalGrossAmount: 50 }

      const result = await create.execute(input as never, ctx)
      // Another actor writes between commit and captureAfter.
      state.invoice!.grandTotalGrossAmount = '999'
      const after = (await create.captureAfter?.(input as never, result, ctx)) as { invoice: Row }

      expect(after.invoice.grandTotalGrossAmount).toBe('50')
    })

    it.each([null, 'not-an-object', ['a'], {}])('stores no custom fields for %p', async (customFields) => {
      const em = makeFakeEm(baseState({ invoice: null, lines: [] }))
      const { ctx } = makeCtx(em)

      await handler('sales.invoices.create').execute(
        { organizationId: ORG_ID, tenantId: TENANT_ID, currencyCode: 'EUR', customFields } as never,
        ctx,
      )

      expect(setRecordCustomFieldsMock).not.toHaveBeenCalled()
    })

    it('rolls the invoice back when the custom-field write fails', async () => {
      const state = baseState({ invoice: null, lines: [] })
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em)
      failNextCustomFieldWrite = true

      await expect(
        handler('sales.invoices.create').execute(
          {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            currencyCode: 'EUR',
            customFields: { amount: 'not-a-number' },
            lines: [{ quantity: 1, currencyCode: 'EUR' }],
          } as never,
          ctx,
        ),
      ).rejects.toThrow('custom field value cannot be stored')

      expect(em.calls.rollbacks).toBe(1)
      expect(state.invoice).toBeNull()
      expect(state.lines).toHaveLength(0)
    })
  })

  describe('update', () => {
    it('updates the header under the sales_invoices row lock and leaves lines alone without replaceLines', async () => {
      const state = baseState()
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em)

      const { result, log } = await runUpdate(
        {
          ...updateScope,
          invoiceNumber: 'INV-2',
          lines: [{ quantity: 2, currencyCode: 'EUR', totalNetAmount: 1, totalGrossAmount: 1 }],
        },
        ctx,
      )

      expect(result).toStrictEqual({ invoiceId: INVOICE_ID })
      expect(lockMock).toHaveBeenCalledWith(em, 'sales_invoices', INVOICE_ID, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
      expect(state.invoice?.invoiceNumber).toBe('INV-2')
      expect(state.lines).toEqual([makeLine()])
      expect(em.calls.lineDeletes).toBe(0)
      expect(log?.snapshotBefore).toMatchObject({ invoice: { invoiceNumber: 'INV-1' } })
      expect(log?.snapshotAfter).toMatchObject({ invoice: { invoiceNumber: 'INV-2' } })
      expect(log?.changes).toStrictEqual({ invoiceNumber: { from: 'INV-1', to: 'INV-2' } })
    })

    it('answers 404 for a missing invoice and when the lock finds no live row', async () => {
      const { ctx } = makeCtx(makeFakeEm(baseState({ invoice: null })))
      await expectStatus(handler('sales.invoices.update').execute(updateScope as never, ctx), 404)

      lockMock.mockResolvedValueOnce(false)
      const { ctx: lockedCtx } = makeCtx(makeFakeEm(baseState()))
      await expectStatus(handler('sales.invoices.update').execute(updateScope as never, lockedCtx), 404)
    })

    it('answers 404 for an invoice in another organization than the request organization', async () => {
      const state = baseState({ invoice: makeInvoice({ organizationId: OTHER_ORG_ID }) })
      const { ctx } = makeCtx(makeFakeEm(state))
      await expectStatus(handler('sales.invoices.update').execute(updateScope as never, ctx), 404)
    })

    it('answers 403 for an invoice id from another tenant, as before, and execute finds nothing outside the tenant', async () => {
      const state = baseState({ invoice: makeInvoice({ tenantId: '77777777-7777-4777-8777-777777777777' }) })
      const { ctx } = makeCtx(makeFakeEm(state))
      const update = handler('sales.invoices.update')

      await expectStatus(Promise.resolve(update.prepare?.(updateScope as never, ctx)), 403)
      await expectStatus(update.execute(updateScope as never, ctx), 404)
    })

    it('answers 403 when the invoice organization is outside the caller scope', async () => {
      const state = baseState({ invoice: makeInvoice({ organizationId: OTHER_ORG_ID }) })
      const { ctx } = makeCtx(makeFakeEm(state))
      await expectStatus(
        Promise.resolve(handler('sales.invoices.update').prepare?.(updateScope as never, ctx)),
        403,
      )
    })

    it('stores header and custom fields together and records custom fields in the audit changes', async () => {
      const state = baseState()
      customFieldStore.set(INVOICE_ID, { company: 'c-1' })
      const { ctx } = makeCtx(makeFakeEm(state))

      const { log } = await runUpdate(
        {
          ...updateScope,
          taxTotalAmount: 24,
          customFieldSetId: '66666666-6666-4666-8666-666666666666',
          customFields: { company: 'c-2', note: '<script>x</script>hi' },
        },
        ctx,
      )

      expect(state.invoice?.taxTotalAmount).toBe('24')
      expect(state.invoice?.customFieldSetId).toBeNull()
      expect(customFieldStore.get(INVOICE_ID)).toEqual({ company: 'c-2', note: 'hi' })
      expect(log?.changes).toMatchObject({
        taxTotalAmount: { from: '23', to: '24' },
        customFields: { from: { cf_company: 'c-1' }, to: { cf_company: 'c-2', cf_note: 'hi' } },
      })
    })

    it('rolls the header back when the custom-field write fails', async () => {
      const state = baseState()
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em)
      failNextCustomFieldWrite = true

      await expect(
        handler('sales.invoices.update').execute(
          { ...updateScope, invoiceNumber: 'INV-2', customFields: { amount: 'x' } } as never,
          ctx,
        ),
      ).rejects.toThrow('custom field value cannot be stored')

      expect(em.calls.rollbacks).toBe(1)
      expect(state.invoice?.invoiceNumber).toBe('INV-1')
    })

  })

  describe('update undo', () => {
    async function updateAndCapture(state: FakeState, input: Row) {
      const { ctx } = makeCtx(makeFakeEm(state))
      const { log } = await runUpdate({ ...updateScope, ...input }, ctx)
      return (log?.payload as { undo: Row }).undo
    }

    it('restores the header and custom fields and clears a field the update added', async () => {
      const state = baseState()
      customFieldStore.set(INVOICE_ID, { company: 'c-1' })
      const undo = await updateAndCapture(state, {
        grandTotalNetAmount: -5,
        customFields: { company: 'c-2', added: 'new' },
      })
      const em = makeFakeEm(state)
      const { ctx, markOrmEntityChange } = makeCtx(em)

      lockMock.mockClear()
      await runUndo('sales.invoices.update', undo, ctx)

      expect(lockMock).toHaveBeenCalledWith(em, 'sales_invoices', INVOICE_ID, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
      // The lock is taken before the current state is read for the stale check.
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(em.findOne.mock.invocationCallOrder[0])
      expect(state.invoice?.grandTotalNetAmount).toBe('100')
      expect(customFieldStore.get(INVOICE_ID)).toEqual({ company: 'c-1', added: null })
      expect(state.lines).toEqual([makeLine()])
      expect(em.calls.lineDeletes).toBe(0)
      expect(markOrmEntityChange).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'updated', indexer: { entityType: E.sales.sales_invoice } }),
      )
    })

    it('rolls back a half-applied undo and leaves header, lines and custom fields as the update left them', async () => {
      const state = baseState()
      customFieldStore.set(INVOICE_ID, { company: 'c-1' })
      const undo = await updateAndCapture(state, {
        subtotalNetAmount: 30,
        subtotalGrossAmount: 36.9,
        taxTotalAmount: 6.9,
        grandTotalNetAmount: 30,
        grandTotalGrossAmount: 36.9,
        customFields: { company: 'c-2' },
      })
      const updatedLines = state.lines.map((line) => ({ ...line }))
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em)
      // The header and lines are restored first; the custom-field reset then fails.
      failNextCustomFieldWrite = true

      await expect(runUndo('sales.invoices.update', undo, ctx)).rejects.toThrow('custom field value cannot be stored')

      expect(em.calls.rollbacks).toBe(1)
      expect(state.invoice?.grandTotalGrossAmount).toBe('36.9')
      expect(state.lines.map((line) => line.id)).toEqual(updatedLines.map((line) => line.id))
      expect(customFieldStore.get(INVOICE_ID)).toEqual({ company: 'c-2' })
    })

    it('undoes an entry written before deployment, built the old way', async () => {
      // Pre-deployment `after` came from a fresh fork after commit; it has the same
      // shape, with dates stored as ISO strings and custom fields keyed `cf_<key>`.
      const legacyInvoice = {
        id: INVOICE_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        invoiceNumber: 'INV-1',
        orderId: null,
        statusEntryId: null,
        status: null,
        issueDate: '2026-11-01T00:00:00.000Z',
        dueDate: null,
        currencyCode: 'EUR',
        subtotalNetAmount: '100',
        subtotalGrossAmount: '123',
        discountTotalAmount: '0',
        taxTotalAmount: '23',
        grandTotalNetAmount: '100',
        grandTotalGrossAmount: '123',
        paidTotalAmount: '0',
        outstandingAmount: '123',
        metadata: null,
        customFieldSetId: null,
        customFields: { cf_company: 'c-1' },
      }
      const { invoice: _ref, organizationId: _o, tenantId: _t, ...legacyLine } = makeLine()
      const undo = {
        before: { invoice: legacyInvoice, lines: [{ ...legacyLine, orderLineId: null }] },
        after: {
          invoice: { ...legacyInvoice, invoiceNumber: 'INV-2', customFields: { cf_company: 'c-2' } },
          lines: [{ ...legacyLine, orderLineId: null }],
        },
      }
      const state = baseState({ invoice: makeInvoice({ invoiceNumber: 'INV-2' }) })
      customFieldStore.set(INVOICE_ID, { company: 'c-2' })
      const { ctx } = makeCtx(makeFakeEm(state))

      await runUndo('sales.invoices.update', undo, ctx)

      expect(state.invoice?.invoiceNumber).toBe('INV-1')
      expect(state.invoice?.issueDate).toEqual(new Date('2026-11-01T00:00:00.000Z'))
      expect(customFieldStore.get(INVOICE_ID)).toEqual({ company: 'c-1' })
    })

    it('answers 409 when the row lock finds no live row, even though the invoice reads unchanged', async () => {
      const state = baseState()
      const undo = await updateAndCapture(state, { invoiceNumber: 'INV-2' })
      lockMock.mockResolvedValueOnce(false)
      const { ctx } = makeCtx(makeFakeEm(state))

      await expectStatus(runUndo('sales.invoices.update', undo, ctx), 409)
      expect(state.invoice?.invoiceNumber).toBe('INV-2')
    })

    it('answers 403 for a caller outside the organization even when the invoice is gone', async () => {
      const state = baseState()
      const undo = await updateAndCapture(state, { invoiceNumber: 'INV-2' })
      state.invoice = null
      const { ctx } = makeCtx(makeFakeEm(state), { selectedOrganizationId: OTHER_ORG_ID })

      await expectStatus(runUndo('sales.invoices.update', undo, ctx), 403)
    })

    it('treats a cleared scalar or multi-value custom field as unchanged', async () => {
      const state = baseState()
      customFieldStore.set(INVOICE_ID, { company: 'c-1', tags: ['a'] })
      const undo = (await updateAndCapture(state, { customFields: { company: 'c-2' } })) as {
        after: { invoice: { customFields: Row } }
      }
      // A clear stored as `null` / `[]` reads back differently from a missing key.
      customFieldStore.set(INVOICE_ID, { company: 'c-2', tags: ['a'], cleared: null, empty: [] })
      undo.after.invoice.customFields = { cf_company: 'c-2', cf_tags: ['a'], cf_other: '' }
      const { ctx } = makeCtx(makeFakeEm(state))

      await runUndo('sales.invoices.update', undo, ctx)

      expect(customFieldStore.get(INVOICE_ID)).toMatchObject({ company: 'c-1' })
    })

    it('answers 403 for a caller outside the invoice organization, before locking', async () => {
      const state = baseState()
      const undo = await updateAndCapture(state, { invoiceNumber: 'INV-2' })
      const { ctx } = makeCtx(makeFakeEm(state), { selectedOrganizationId: OTHER_ORG_ID })
      lockMock.mockClear()

      await expectStatus(runUndo('sales.invoices.update', undo, ctx), 403)
      expect(lockMock).not.toHaveBeenCalled()
    })
  })

  describe('create undo', () => {
    async function createAndCapture(state: FakeState, input: Row = {}) {
      const { ctx } = makeCtx(makeFakeEm(state))
      const create = handler('sales.invoices.create')
      const payload = {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        currencyCode: 'EUR',
        lines: [{ quantity: 1, currencyCode: 'EUR', totalNetAmount: 10, totalGrossAmount: 12.3 }],
        ...input,
      }
      const result = await create.execute(payload as never, ctx)
      const after = await create.captureAfter?.(payload as never, result, ctx)
      const log = await create.buildLog?.({ input: payload as never, result, ctx, snapshots: { after } })
      return { undo: (log?.payload as { undo: Row }).undo, invoiceId: result.invoiceId }
    }

    it('deletes the invoice, its lines and its custom-field rows and removes them from the index', async () => {
      const state = baseState({ invoice: null, lines: [] })
      const { undo, invoiceId } = await createAndCapture(state, { customFields: { company: 'c-1', tags: ['a'] } })
      const lineId = state.lines[0].id
      const em = makeFakeEm(state)
      const { ctx, markOrmEntityChange } = makeCtx(em)

      await runUndo('sales.invoices.create', undo, ctx)

      // `FOR UPDATE` so an allocation insert in flight blocks the undo until it commits.
      expect(em.findOne).toHaveBeenCalledWith(
        SalesInvoice,
        { id: invoiceId, deletedAt: null, organizationId: ORG_ID, tenantId: TENANT_ID },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      expect(em.findOne.mock.invocationCallOrder[0]).toBeLessThan(em.count.mock.invocationCallOrder[0])
      expect(state.invoice).toBeNull()
      expect(state.lines).toHaveLength(0)
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomFieldValue, {
        entityId: E.sales.sales_invoice,
        recordId: invoiceId,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
      expect(customFieldStore.has(invoiceId)).toBe(false)
      expect(markOrmEntityChange).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deleted', identifiers: expect.objectContaining({ id: invoiceId }) }),
      )
      expect(markOrmEntityChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'deleted',
          identifiers: expect.objectContaining({ id: lineId }),
          indexer: { entityType: E.sales.sales_invoice_line },
        }),
      )
    })

    it.each([
      ['a payment allocation', { allocations: 1, creditMemos: 0, notes: 0 }],
      ['a credit memo', { allocations: 0, creditMemos: 1, notes: 0 }],
      ['a note', { allocations: 0, creditMemos: 0, notes: 1 }],
    ])('answers 409 and keeps everything linked when %s references the invoice', async (_label, dependants) => {
      const state = baseState({ invoice: null, lines: [] })
      const { undo } = await createAndCapture(state)
      state.dependants = dependants
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em)

      await expectStatus(runUndo('sales.invoices.create', undo, ctx), 409)

      expect(state.invoice).not.toBeNull()
      expect(state.lines).toHaveLength(1)
      expect(em.calls.invoiceDeletes).toBe(0)
    })

    it('answers 403 for a caller outside the organization, before locking', async () => {
      const state = baseState({ invoice: null, lines: [] })
      const { undo } = await createAndCapture(state)
      state.invoice = null
      const em = makeFakeEm(state)
      const { ctx } = makeCtx(em, { selectedOrganizationId: OTHER_ORG_ID })

      await expectStatus(runUndo('sales.invoices.create', undo, ctx), 403)
      expect(em.findOne).not.toHaveBeenCalled()
    })

    it('answers 409 after a later update by another actor and for a soft-deleted invoice', async () => {
      const state = baseState({ invoice: null, lines: [] })
      const { undo } = await createAndCapture(state)
      state.invoice!.grandTotalGrossAmount = '999'
      const { ctx } = makeCtx(makeFakeEm(state))
      await expectStatus(runUndo('sales.invoices.create', undo, ctx), 409)

      state.invoice!.deletedAt = new Date()
      const { ctx: deletedCtx } = makeCtx(makeFakeEm(state))
      await expectStatus(runUndo('sales.invoices.create', undo, deletedCtx), 409)
      expect(state.invoice).not.toBeNull()
    })
  })
})
