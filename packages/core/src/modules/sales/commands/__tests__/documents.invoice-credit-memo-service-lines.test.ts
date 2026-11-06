/** @jest-environment node */

/**
 * Invoice and credit memo lines keep the catalog service a billed line came
 * from, so a service sold on an order stays identifiable on the documents that
 * bill and refund it.
 */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { catalogServiceQueries, catalogServiceRow, type CatalogServiceRow } from './catalogServiceFixture'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
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

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  },
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SERVICE_ID = '99999999-9999-4999-8999-999999999999'
const UNKNOWN_SERVICE_ID = '88888888-8888-4888-8888-888888888888'
const OTHER_ORG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

function setCatalogServices(services: CatalogServiceRow[]) {
  ;(globalThis as { __catalogServices?: CatalogServiceRow[] }).__catalogServices = services
}

function buildCtx() {
  const created: Array<{ entity: string; data: Record<string, unknown> }> = []
  const em: Record<string, unknown> = {
    create: jest.fn((entity: { name?: string }, data: Record<string, unknown>) => {
      created.push({ entity: entity?.name ?? '', data })
      return { ...data }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
  }
  em.fork = jest.fn(() => em)
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesDocumentNumberGenerator: asValue({ generate: jest.fn(async () => ({ number: 'DOC-1' })) }),
  })
  const ctx: CommandRuntimeContext = {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return { ctx, created }
}

const serviceLine = {
  kind: 'service',
  serviceId: SERVICE_ID,
  name: 'Implementation workshop',
  quantity: 2,
  currencyCode: 'USD',
  unitPriceNet: 100,
  unitPriceGross: 100,
  totalNetAmount: 200,
  totalGrossAmount: 200,
}

describe('invoice and credit memo service lines', () => {
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

  it.each([
    ['sales.invoices.create', 'SalesInvoiceLine', { invoiceNumber: 'INV-1' }],
    ['sales.credit_memos.create', 'SalesCreditMemoLine', { creditMemoNumber: 'CM-1' }],
  ])('%s keeps the line kind and service reference', async (commandId, lineEntity, numbering) => {
    const handler = commandRegistry.get(commandId)
    expect(handler).toBeTruthy()
    const { ctx, created } = buildCtx()

    await handler!.execute(
      {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        currencyCode: 'USD',
        ...numbering,
        lines: [serviceLine, { name: 'Freeform', quantity: 1, currencyCode: 'USD' }],
      },
      ctx,
    )

    const lines = created.filter((entry) => entry.entity === lineEntity).map((entry) => entry.data)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'service', serviceId: SERVICE_ID })
    expect(lines[1]).toMatchObject({ kind: 'product', serviceId: null })
  })

  it.each([
    ['sales.invoices.create', 'SalesInvoiceLine', { invoiceNumber: 'INV-1' }],
    ['sales.credit_memos.create', 'SalesCreditMemoLine', { creditMemoNumber: 'CM-1' }],
  ])('%s rejects a non-service line that references a service', async (commandId, lineEntity, numbering) => {
    const handler = commandRegistry.get(commandId)
    expect(handler).toBeTruthy()
    const { ctx, created } = buildCtx()

    await expect(
      handler!.execute(
        {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          currencyCode: 'USD',
          ...numbering,
          lines: [
            { name: 'Freeform', quantity: 1, currencyCode: 'USD' },
            { ...serviceLine, kind: 'product' },
          ],
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('references a service but is not a service line') },
    })

    expect(created.filter((entry) => entry.entity === lineEntity)).toHaveLength(0)
    expect(ctx.container.resolve<{ persist: jest.Mock }>('em').persist).not.toHaveBeenCalled()
  })

  const documentCommands = [
    ['sales.invoices.create', 'SalesInvoiceLine', { invoiceNumber: 'INV-1' }],
    ['sales.credit_memos.create', 'SalesCreditMemoLine', { creditMemoNumber: 'CM-1' }],
  ] as const

  it.each(documentCommands)(
    '%s keeps a service that was archived after the order line was sold',
    async (commandId, lineEntity, numbering) => {
      setCatalogServices([catalogServiceRow(SERVICE_ID, SCOPE, new Date('2026-10-01T00:00:00.000Z'))])
      const handler = commandRegistry.get(commandId)
      const { ctx, created } = buildCtx()

      await handler!.execute(
        { organizationId: ORG_ID, tenantId: TENANT_ID, currencyCode: 'USD', ...numbering, lines: [serviceLine] },
        ctx,
      )

      const lines = created.filter((entry) => entry.entity === lineEntity).map((entry) => entry.data)
      expect(lines).toEqual([expect.objectContaining({ kind: 'service', serviceId: SERVICE_ID })])
      expect(catalogServiceQueries(findWithDecryption as jest.Mock)).toEqual([
        { id: { $in: [SERVICE_ID] }, tenantId: TENANT_ID, organizationId: ORG_ID },
      ])
    },
  )

  it.each(documentCommands)(
    '%s rejects a service that does not exist in the organization',
    async (commandId, lineEntity, numbering) => {
      setCatalogServices([catalogServiceRow(UNKNOWN_SERVICE_ID, { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID })])
      const handler = commandRegistry.get(commandId)
      const { ctx, created } = buildCtx()

      await expect(
        handler!.execute(
          {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            currencyCode: 'USD',
            ...numbering,
            lines: [serviceLine, { ...serviceLine, serviceId: UNKNOWN_SERVICE_ID }],
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        status: 400,
        body: { error: expect.stringContaining('references a service that does not exist in this organization') },
      })

      expect(created.filter((entry) => entry.entity === lineEntity)).toHaveLength(0)
      expect(created).toHaveLength(0)
      expect(catalogServiceQueries(findWithDecryption as jest.Mock)).toHaveLength(1)
    },
  )
})
