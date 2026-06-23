/** @jest-environment node */

export {}

const registerCommand = jest.fn()
const invalidateCrudCache = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache,
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_LINE_ID = '55555555-5555-4555-8555-555555555555'
const STATUS_ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const SENT_STATUS_ENTRY_ID = '77777777-7777-4777-8777-777777777777'

type RegisteredCommand = {
  execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown>
}

function loadCommand(id: string): RegisteredCommand {
  let command: unknown
  jest.isolateModules(() => {
    require('../documents')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!command) throw new Error(`command ${id} not registered`)
  return command as RegisteredCommand
}

function entityName(entity: unknown): string {
  return typeof entity === 'function' ? entity.name : ''
}

function buildEm(options: { invoice?: Record<string, unknown> | null; statusValue?: string; statusEntryId?: string } = {}) {
  const dictionary = { id: 'dictionary-1' }
  const statusEntry = { id: options.statusEntryId ?? STATUS_ENTRY_ID, value: options.statusValue ?? 'draft' }
  const order = { id: ORDER_ID, organizationId: ORG, tenantId: TENANT }
  const orderLine = { id: ORDER_LINE_ID, order, organizationId: ORG, tenantId: TENANT }
  const createdInvoices: Array<Record<string, unknown>> = []
  const createdLines: Array<Record<string, unknown>> = []

  const em: Record<string, unknown> = {
    fork: jest.fn(),
    findOne: jest.fn().mockImplementation(async (entity: unknown) => {
      switch (entityName(entity)) {
        case 'Dictionary':
          return dictionary
        case 'DictionaryEntry':
          return statusEntry
        case 'SalesOrder':
          return order
        case 'SalesInvoice':
          return options.invoice ?? null
        default:
          return null
      }
    }),
    findOneOrFail: jest.fn().mockImplementation(async (entity: unknown) => {
      if (entityName(entity) === 'SalesInvoice' && options.invoice) return options.invoice
      throw new Error('not found')
    }),
    find: jest.fn().mockImplementation(async (entity: unknown) => {
      if (entityName(entity) === 'SalesOrderLine') return [orderLine]
      return []
    }),
    create: jest.fn().mockImplementation((entity: unknown, payload: Record<string, unknown>) => {
      const record = { ...payload }
      if (entityName(entity) === 'SalesInvoice') createdInvoices.push(record)
      if (entityName(entity) === 'SalesInvoiceLine') createdLines.push(record)
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    createdInvoices,
    createdLines,
    order,
    orderLine,
  }
  ;(em.fork as jest.Mock).mockReturnValue(em)
  return em
}

function buildCtx(em: Record<string, unknown>) {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  return {
    ctx: {
      container: {
        resolve: jest.fn((token: string) => {
          if (token === 'em') return em
          if (token === 'dataEngine') return dataEngine
          if (token === 'salesDocumentNumberGenerator') {
            return { generate: jest.fn().mockResolvedValue({ number: 'INV-TEST-1' }) }
          }
          return undefined
        }),
      },
      auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
      organizationScope: null,
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
    },
    dataEngine,
  }
}

describe('sales.invoices.create command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('defaults invoices to draft and writes order/order-line relations', async () => {
    const command = loadCommand('sales.invoices.create')
    const em = buildEm()
    const { ctx, dataEngine } = buildCtx(em)

    const result = await command.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        orderId: ORDER_ID,
        invoiceNumber: 'INV-TEST-1',
        currencyCode: 'EUR',
        grandTotalNetAmount: 100,
        grandTotalGrossAmount: 123,
        outstandingAmount: 123,
        lines: [
          {
            orderLineId: ORDER_LINE_ID,
            quantity: 2,
            currencyCode: 'EUR',
            unitPriceNet: 50,
            unitPriceGross: 61.5,
            totalNetAmount: 100,
            totalGrossAmount: 123,
          },
        ],
      },
      ctx,
    )

    const invoice = (em.createdInvoices as Array<Record<string, unknown>>)[0]
    const line = (em.createdLines as Array<Record<string, unknown>>)[0]

    expect(result).toEqual({ invoiceId: invoice.id })
    expect(invoice).toMatchObject({
      order: em.order,
      statusEntryId: STATUS_ENTRY_ID,
      status: 'draft',
      invoiceNumber: 'INV-TEST-1',
    })
    expect(line).toMatchObject({
      invoice,
      orderLine: em.orderLine,
      totalGrossAmount: '123',
    })
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        entity: invoice,
      }),
    )
  })
})

describe('sales.invoices.update command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('updates invoice status fields without assigning audit diff objects', async () => {
    const command = loadCommand('sales.invoices.update')
    const invoice = {
      id: '88888888-8888-4888-8888-888888888888',
      organizationId: ORG,
      tenantId: TENANT,
      invoiceNumber: 'INV-TEST-1',
      statusEntryId: STATUS_ENTRY_ID,
      status: 'draft',
      currencyCode: 'EUR',
      grandTotalGrossAmount: '123',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    }
    const em = buildEm({ invoice, statusEntryId: SENT_STATUS_ENTRY_ID, statusValue: 'sent' })
    const { ctx, dataEngine } = buildCtx(em)

    const result = await command.execute(
      {
        id: invoice.id,
        organizationId: ORG,
        tenantId: TENANT,
        statusEntryId: SENT_STATUS_ENTRY_ID,
        currencyCode: 'EUR',
      },
      ctx,
    )

    expect(result).toEqual({ invoiceId: invoice.id })
    expect(invoice.statusEntryId).toBe(SENT_STATUS_ENTRY_ID)
    expect(invoice.status).toBe('sent')
    expect(invoice.statusEntryId).not.toEqual(expect.objectContaining({ from: expect.anything(), to: expect.anything() }))
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        entity: invoice,
      }),
    )
  })
})
