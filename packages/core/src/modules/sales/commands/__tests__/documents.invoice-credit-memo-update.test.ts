/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import {
  creditMemoUpdateSchema,
  invoiceUpdateSchema,
} from '../../data/validators'
import { SalesCreditMemo, SalesInvoice } from '../../data/entities'

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
  return {
    ...actual,
    invalidateCrudCache: jest.fn(async () => undefined),
  }
})

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const INVOICE_ID = '33333333-3333-4333-8333-333333333333'
const CREDIT_MEMO_ID = '44444444-4444-4444-8444-444444444444'

type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>
type CreditMemoUpdateInput = z.infer<typeof creditMemoUpdateSchema>

type InvoiceUpdateResult = { invoiceId: string }
type CreditMemoUpdateResult = { creditMemoId: string }

const invoiceHeaderKeys = [
  'invoiceNumber',
  'statusEntryId',
  'status',
  'issueDate',
  'dueDate',
  'currencyCode',
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
  'paidTotalAmount',
  'outstandingAmount',
  'metadata',
] as const

const creditMemoHeaderKeys = [
  'creditMemoNumber',
  'statusEntryId',
  'status',
  'reason',
  'issueDate',
  'currencyCode',
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'taxTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
  'metadata',
] as const

function makeInvoice(): SalesInvoice {
  return Object.assign(new SalesInvoice(), {
    id: INVOICE_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    invoiceNumber: 'INV-OLD',
    statusEntryId: null,
    status: null,
    issueDate: new Date('2026-07-01T00:00:00.000Z'),
    dueDate: new Date('2026-07-31T00:00:00.000Z'),
    currencyCode: 'USD',
    subtotalNetAmount: '100',
    subtotalGrossAmount: '123',
    discountTotalAmount: '5',
    taxTotalAmount: '23',
    grandTotalNetAmount: '95',
    grandTotalGrossAmount: '118',
    paidTotalAmount: '40',
    outstandingAmount: '78',
    metadata: { source: 'stored' },
    deletedAt: null,
  })
}

function makeCreditMemo(): SalesCreditMemo {
  return Object.assign(new SalesCreditMemo(), {
    id: CREDIT_MEMO_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    creditMemoNumber: 'CM-OLD',
    statusEntryId: null,
    status: null,
    reason: 'Stored reason',
    issueDate: new Date('2026-07-02T00:00:00.000Z'),
    currencyCode: 'EUR',
    subtotalNetAmount: '50',
    subtotalGrossAmount: '61.5',
    taxTotalAmount: '11.5',
    grandTotalNetAmount: '50',
    grandTotalGrossAmount: '61.5',
    metadata: { source: 'stored' },
    deletedAt: null,
  })
}

function makeHarness(entity: SalesInvoice | SalesCreditMemo) {
  const findOneOrFail = jest.fn(async () => entity)
  const flush = jest.fn(async () => undefined)
  const entityManager = {
    findOneOrFail,
    flush,
    fork: jest.fn(),
  }
  entityManager.fork.mockReturnValue(entityManager)

  const markOrmEntityChange = jest.fn((_change: unknown) => undefined)
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(entityManager as unknown as EntityManager),
    dataEngine: asValue({ markOrmEntityChange }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: {
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      sub: 'user-1',
    },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: [ORGANIZATION_ID],
  }

  return {
    ctx,
    container,
    findOneOrFail,
    flush,
    markOrmEntityChange,
  }
}

function expectNoDiffObjects(
  entity: SalesInvoice | SalesCreditMemo,
  keys: readonly string[],
): void {
  const values = entity as unknown as Record<string, unknown>
  const receivedDiffObject = keys.some((key) => {
    const value = values[key]
    return value !== null
      && typeof value === 'object'
      && 'from' in value
      && 'to' in value
  })

  expect(receivedDiffObject).toBe(false)
}

function buildInvoiceSnapshot(
  overrides: Partial<ReturnType<typeof buildInvoiceSnapshot>['invoice']> = {},
) {
  return {
    invoice: {
      id: INVOICE_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      invoiceNumber: 'INV-BEFORE',
      orderId: null,
      statusEntryId: null,
      status: null,
      issueDate: null,
      dueDate: null,
      currencyCode: 'USD',
      subtotalNetAmount: '100',
      subtotalGrossAmount: '123',
      discountTotalAmount: '5',
      taxTotalAmount: '23',
      grandTotalNetAmount: '95',
      grandTotalGrossAmount: '118',
      paidTotalAmount: '40',
      outstandingAmount: '78',
      metadata: null,
      customFieldSetId: null,
      customFields: null,
      ...overrides,
    },
    lines: [],
  }
}

function buildCreditMemoSnapshot(
  overrides: Partial<ReturnType<typeof buildCreditMemoSnapshot>['creditMemo']> = {},
) {
  return {
    creditMemo: {
      id: CREDIT_MEMO_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      creditMemoNumber: 'CM-BEFORE',
      orderId: null,
      invoiceId: null,
      statusEntryId: null,
      status: null,
      reason: 'Before reason',
      issueDate: null,
      currencyCode: 'EUR',
      subtotalNetAmount: '50',
      subtotalGrossAmount: '61.5',
      taxTotalAmount: '11.5',
      grandTotalNetAmount: '50',
      grandTotalGrossAmount: '61.5',
      metadata: null,
      customFieldSetId: null,
      customFields: null,
      ...overrides,
    },
    lines: [],
  }
}

function getInvoiceUpdateHandler() {
  const handler = commandRegistry.get<InvoiceUpdateInput, InvoiceUpdateResult>(
    'sales.invoices.update',
  )
  if (!handler) throw new Error('[internal] sales.invoices.update was not registered')
  return handler
}

function getCreditMemoUpdateHandler() {
  const handler = commandRegistry.get<CreditMemoUpdateInput, CreditMemoUpdateResult>(
    'sales.credit_memos.update',
  )
  if (!handler) throw new Error('[internal] sales.credit_memos.update was not registered')
  return handler
}

describe('invoice and credit memo header updates', () => {
  const invalidateMock = jest.mocked(invalidateCrudCache)

  beforeAll(async () => {
    commandRegistry.clear()
    await import('../documents')
  })

  afterEach(() => {
    invalidateMock.mockClear()
  })

  it('sales.invoices.update assigns scalar values, normalizes numbers, and preserves omitted fields', async () => {
    const invoice = makeInvoice()
    const originalDueDate = invoice.dueDate
    const originalDiscount = invoice.discountTotalAmount
    const { ctx, container, findOneOrFail, flush, markOrmEntityChange } = makeHarness(invoice)
    const handler = getInvoiceUpdateHandler()
    const issueDate = new Date('2026-08-10T00:00:00.000Z')

    const result = await handler.execute({
      id: INVOICE_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      invoiceNumber: 'INV-UPDATED',
      issueDate,
      currencyCode: 'PLN',
      subtotalNetAmount: 125.5,
      taxTotalAmount: 28.865,
      grandTotalGrossAmount: 154.365,
      metadata: { source: 'updated' },
    }, ctx)

    expect(handler.id).toBe('sales.invoices.update')
    expect(result).toStrictEqual({ invoiceId: INVOICE_ID })
    expect(findOneOrFail).toHaveBeenCalledWith(SalesInvoice, {
      id: INVOICE_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      deletedAt: null,
    })
    expect(invoice).toMatchObject({
      invoiceNumber: 'INV-UPDATED',
      issueDate,
      dueDate: originalDueDate,
      currencyCode: 'PLN',
      subtotalNetAmount: '125.5',
      subtotalGrossAmount: '123',
      discountTotalAmount: originalDiscount,
      taxTotalAmount: '28.865',
      grandTotalGrossAmount: '154.365',
      paidTotalAmount: '40',
      outstandingAmount: '78',
      metadata: { source: 'updated' },
    })
    expectNoDiffObjects(invoice, invoiceHeaderKeys)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      entity: invoice,
      identifiers: {
        id: INVOICE_ID,
        organizationId: ORGANIZATION_ID,
        tenantId: TENANT_ID,
      },
      events: expect.objectContaining({}),
      indexer: expect.objectContaining({ entityType: expect.stringContaining('invoice') }),
    }))
    expect(invalidateMock).toHaveBeenCalledWith(
      container,
      'sales.invoice',
      {
        id: INVOICE_ID,
        organizationId: ORGANIZATION_ID,
        tenantId: TENANT_ID,
      },
      TENANT_ID,
      'updated',
    )
  })

  it('sales.invoices.update builds audit changes from snapshots and retains the undo envelope', async () => {
    const invoice = makeInvoice()
    const { ctx } = makeHarness(invoice)
    const handler = getInvoiceUpdateHandler()
    const before = buildInvoiceSnapshot()
    const after = buildInvoiceSnapshot({
      invoiceNumber: 'INV-AFTER',
      subtotalNetAmount: '125.5',
    })

    const metadata = await handler.buildLog?.({
      input: {
        id: INVOICE_ID,
        invoiceNumber: 'INPUT-MUST-NOT-DRIVE-THE-DIFF',
        subtotalNetAmount: 999,
      },
      result: { invoiceId: INVOICE_ID },
      ctx,
      snapshots: { before, after },
    })

    expect(metadata?.snapshotBefore).toBe(before)
    expect(metadata?.snapshotAfter).toBe(after)
    expect(metadata?.changes).toStrictEqual({
      invoiceNumber: { from: 'INV-BEFORE', to: 'INV-AFTER' },
      subtotalNetAmount: { from: '100', to: '125.5' },
    })
    expect(metadata?.payload).toStrictEqual({ undo: { before, after } })
  })

  it('sales.credit_memos.update assigns scalar values, normalizes numbers, and preserves omitted fields', async () => {
    const creditMemo = makeCreditMemo()
    const originalIssueDate = creditMemo.issueDate
    const originalMetadata = creditMemo.metadata
    const { ctx, container, findOneOrFail, flush, markOrmEntityChange } = makeHarness(creditMemo)
    const handler = getCreditMemoUpdateHandler()

    const result = await handler.execute({
      id: CREDIT_MEMO_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      creditMemoNumber: 'CM-UPDATED',
      reason: 'Corrected amount',
      currencyCode: 'PLN',
      subtotalGrossAmount: 75.25,
      taxTotalAmount: 14.07,
      grandTotalNetAmount: 61.18,
    }, ctx)

    expect(handler.id).toBe('sales.credit_memos.update')
    expect(result).toStrictEqual({ creditMemoId: CREDIT_MEMO_ID })
    expect(findOneOrFail).toHaveBeenCalledWith(SalesCreditMemo, {
      id: CREDIT_MEMO_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      deletedAt: null,
    })
    expect(creditMemo).toMatchObject({
      creditMemoNumber: 'CM-UPDATED',
      reason: 'Corrected amount',
      issueDate: originalIssueDate,
      currencyCode: 'PLN',
      subtotalNetAmount: '50',
      subtotalGrossAmount: '75.25',
      taxTotalAmount: '14.07',
      grandTotalNetAmount: '61.18',
      grandTotalGrossAmount: '61.5',
      metadata: originalMetadata,
    })
    expectNoDiffObjects(creditMemo, creditMemoHeaderKeys)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      entity: creditMemo,
      identifiers: {
        id: CREDIT_MEMO_ID,
        organizationId: ORGANIZATION_ID,
        tenantId: TENANT_ID,
      },
      events: expect.objectContaining({}),
      indexer: expect.objectContaining({ entityType: expect.stringContaining('credit_memo') }),
    }))
    expect(invalidateMock).toHaveBeenCalledWith(
      container,
      'sales.credit_memo',
      {
        id: CREDIT_MEMO_ID,
        organizationId: ORGANIZATION_ID,
        tenantId: TENANT_ID,
      },
      TENANT_ID,
      'updated',
    )
  })

  it('sales.credit_memos.update builds audit changes from snapshots and retains the undo envelope', async () => {
    const creditMemo = makeCreditMemo()
    const { ctx } = makeHarness(creditMemo)
    const handler = getCreditMemoUpdateHandler()
    const before = buildCreditMemoSnapshot()
    const after = buildCreditMemoSnapshot({
      reason: 'After reason',
      grandTotalGrossAmount: '75.25',
    })

    const metadata = await handler.buildLog?.({
      input: {
        id: CREDIT_MEMO_ID,
        reason: 'INPUT-MUST-NOT-DRIVE-THE-DIFF',
        grandTotalGrossAmount: 999,
      },
      result: { creditMemoId: CREDIT_MEMO_ID },
      ctx,
      snapshots: { before, after },
    })

    expect(metadata?.snapshotBefore).toBe(before)
    expect(metadata?.snapshotAfter).toBe(after)
    expect(metadata?.changes).toStrictEqual({
      reason: { from: 'Before reason', to: 'After reason' },
      grandTotalGrossAmount: { from: '61.5', to: '75.25' },
    })
    expect(metadata?.payload).toStrictEqual({ undo: { before, after } })
  })
})
