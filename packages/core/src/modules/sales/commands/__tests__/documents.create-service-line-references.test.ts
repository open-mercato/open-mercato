/** @jest-environment node */

/**
 * Document creation must keep accepting the service-kind lines existing
 * producers send. InboxOps maps an extracted service item to `kind: 'service'`
 * carrying the matched catalog product and no catalog service, so the line
 * reference rule may only reject a service reference combined with a product.
 */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
import { catalogServiceQueries, catalogServiceRow, type CatalogServiceRow } from './catalogServiceFixture'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_order_adjustment: 'sales.sales_order_adjustment',
      sales_quote: 'sales.sales_quote',
      sales_quote_line: 'sales.sales_quote_line',
      sales_quote_adjustment: 'sales.sales_quote_adjustment',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(),
  }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown, where: unknown) => {
    const fixture = require('./catalogServiceFixture')
    if (!fixture.isCatalogServiceEntity(entityClass)) return []
    const services: CatalogServiceRow[] = (globalThis as { __catalogServices?: CatalogServiceRow[] }).__catalogServices ?? []
    return fixture.matchCatalogServices(services, where)
  }),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: jest.fn(async () => undefined) }),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555'
const SERVICE_ID = '77777777-7777-4777-8777-777777777777'
const UNKNOWN_SERVICE_ID = '88888888-8888-4888-8888-888888888888'
const SCOPE = { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID }
const SERVICE_NOT_FOUND = 'references a service that does not exist in this organization'

function setCatalogServices(services: CatalogServiceRow[]) {
  ;(globalThis as { __catalogServices?: CatalogServiceRow[] }).__catalogServices = services
}

type CreatedRecord = Record<string, unknown>

function buildHarness() {
  let inTransaction = false
  const created: CreatedRecord[] = []
  const em: Record<string, unknown> = {
    create: (_entity: unknown, data: CreatedRecord) => {
      const record = { ...data }
      created.push(record)
      return record
    },
    persist: () => undefined,
    find: async () => [],
    findOne: async () => null,
    nativeDelete: async () => 0,
    remove: jest.fn(),
    flush: async () => undefined,
    isInTransaction: () => inTransaction,
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    getReference: (_entity: unknown, id: unknown) => ({ id }),
  }
  em.fork = () => em

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({}),
    eventBus: asValue({ emit: async () => undefined, emitEvent: async () => undefined }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({ generate: async () => ({ number: 'DOC-1' }) }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { ctx, created }
}

const inboxOpsServiceLine = {
  lineNumber: 1,
  kind: 'service',
  name: 'Installation',
  quantity: 2,
  currencyCode: 'USD',
  productId: PRODUCT_ID,
  unitPriceNet: 50,
}

function buildInput(lines: Array<Record<string, unknown>>) {
  return {
    organizationId: TEST_ORG_ID,
    tenantId: TEST_TENANT_ID,
    currencyCode: 'USD',
    lines,
  }
}

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../documents')
})

beforeEach(() => {
  setCatalogServices([catalogServiceRow(SERVICE_ID, SCOPE)])
  ;(findWithDecryption as jest.Mock).mockClear()
})

afterAll(() => {
  delete (globalThis as { __catalogServices?: CatalogServiceRow[] }).__catalogServices
})

describe.each([
  ['sales.quotes.create', 'quoteId'],
  ['sales.orders.create', 'orderId'],
])('%s — service line references', (commandId, resultKey) => {
  function getHandler() {
    const handler = commandRegistry.get<unknown, Record<string, string | undefined>>(commandId)
    expect(handler).toBeTruthy()
    return handler!
  }

  it('accepts an InboxOps service line that carries a matched product and no service', async () => {
    const { ctx, created } = buildHarness()

    const result = await getHandler().execute(buildInput([inboxOpsServiceLine]) as never, ctx)

    expect(result[resultKey]).toEqual(expect.any(String))
    const persistedLine = created.find((record) => record.name === 'Installation' && 'kind' in record)
    expect(persistedLine).toMatchObject({ kind: 'service', productId: PRODUCT_ID, serviceId: null })
  })

  it('accepts a custom line that sends explicit null references, unit and snapshot', async () => {
    const { ctx, created } = buildHarness()

    const result = await getHandler().execute(
      buildInput([
        {
          lineNumber: 1,
          kind: 'product',
          name: 'Freeform',
          quantity: 3,
          currencyCode: 'USD',
          productId: null,
          productVariantId: null,
          serviceId: null,
          quantityUnit: null,
          catalogSnapshot: null,
          unitPriceNet: 10,
        },
      ]) as never,
      ctx,
    )

    expect(result[resultKey]).toEqual(expect.any(String))
    const persistedLine = created.find((record) => record.name === 'Freeform' && 'kind' in record)
    expect(persistedLine).toMatchObject({
      kind: 'product',
      productId: null,
      productVariantId: null,
      serviceId: null,
      quantityUnit: null,
      catalogSnapshot: null,
    })
    expect(catalogServiceQueries(findWithDecryption as jest.Mock)).toHaveLength(0)
  })

  it('rejects a line that references a service and a product at the same time', async () => {
    const { ctx } = buildHarness()

    await expect(
      getHandler().execute(
        buildInput([{ ...inboxOpsServiceLine, serviceId: SERVICE_ID }]) as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('cannot reference both a service and a product') },
    })
  })

  const catalogServiceLine = {
    lineNumber: 1,
    kind: 'service',
    name: 'Workshop',
    quantity: 1,
    currencyCode: 'USD',
    serviceId: SERVICE_ID,
    unitPriceNet: 100,
  }

  it('accepts a service line whose service exists in the organization, looked up once in scope', async () => {
    const { ctx, created } = buildHarness()

    await getHandler().execute(
      buildInput([catalogServiceLine, { ...catalogServiceLine, lineNumber: 2 }]) as never,
      ctx,
    )

    expect(created.find((record) => record.name === 'Workshop' && 'kind' in record)).toMatchObject({
      kind: 'service',
      serviceId: SERVICE_ID,
    })
    expect(catalogServiceQueries(findWithDecryption as jest.Mock)).toEqual([
      { id: { $in: [SERVICE_ID] }, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, deletedAt: null },
    ])
  })

  it('rejects a service line whose service does not exist in the organization and creates nothing', async () => {
    const { ctx, created } = buildHarness()

    await expect(
      getHandler().execute(
        buildInput([inboxOpsServiceLine, { ...catalogServiceLine, lineNumber: 2, serviceId: UNKNOWN_SERVICE_ID }]) as never,
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400, body: { error: expect.stringContaining(SERVICE_NOT_FOUND) } })
    expect(created).toHaveLength(0)
  })

  it('rejects a service line whose service was archived', async () => {
    setCatalogServices([catalogServiceRow(SERVICE_ID, SCOPE, new Date('2026-10-01T00:00:00.000Z'))])
    const { ctx, created } = buildHarness()

    await expect(
      getHandler().execute(buildInput([catalogServiceLine]) as never, ctx),
    ).rejects.toMatchObject({ status: 400, body: { error: expect.stringContaining(SERVICE_NOT_FOUND) } })
    expect(created).toHaveLength(0)
  })
})
