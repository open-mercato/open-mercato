import { z, ZodError, type ZodTypeAny } from 'zod'
import { orderLineCreateSchema, orderLineUpdateSchema } from '../../data/validators'

const makeCrudRouteMock = jest.fn(() => ({
  GET: jest.fn(),
  POST: jest.fn(),
  PUT: jest.fn(),
  DELETE: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (...args: unknown[]) => makeCrudRouteMock(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { makeSalesLineRoute } from '../makeSalesLineRoute'

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const STATUS_ENTRY_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

type MapInput = (args: { raw: unknown; ctx: unknown }) => Promise<{ body: Record<string, unknown> }>

function buildRoute(options: { partialUpdates?: boolean } = {}) {
  makeCrudRouteMock.mockClear()
  const route = makeSalesLineRoute({
    entity: class SalesOrderLine {},
    entityId: 'sales:sales_order_line',
    fieldConstants: { id: 'id', order_id: 'order_id' },
    parentFkColumn: 'order_id',
    parentFkParam: 'orderId',
    createSchema: orderLineCreateSchema,
    ...(options.partialUpdates === false ? {} : { updateSchema: orderLineUpdateSchema }),
    features: { view: 'sales.orders.view', manage: 'sales.orders.manage' },
    commandPrefix: 'sales.orders.lines',
    openApi: { resourceName: 'Order line', description: 'an order line' },
  })
  const config = makeCrudRouteMock.mock.calls.at(-1)?.[0] as unknown as {
    actions: { create: { mapInput: MapInput }; update: { mapInput: MapInput } }
  }
  return { actions: config.actions, openApi: route.openApi }
}

function buildActions(options: { partialUpdates?: boolean } = {}) {
  return buildRoute(options).actions
}

function putRequestSchema(options: { partialUpdates?: boolean } = {}): ZodTypeAny {
  const schema = buildRoute(options).openApi.methods.PUT?.requestBody?.schema
  if (!schema) throw new Error('PUT request body schema missing')
  return schema
}

const completeLine = {
  orderId: ORDER_ID,
  currencyCode: 'USD',
  quantity: 1,
  name: 'Widget',
}

const ctx = {
  auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
  selectedOrganizationId: ORG_ID,
}

describe('makeSalesLineRoute PUT partial updates (#6947)', () => {
  it('accepts a status-only update of an existing line', async () => {
    const { update } = buildActions()

    const { body } = await update.mapInput({
      raw: { id: LINE_ID, orderId: ORDER_ID, statusEntryId: STATUS_ENTRY_ID },
      ctx,
    })

    expect(body).toEqual({
      id: LINE_ID,
      orderId: ORDER_ID,
      statusEntryId: STATUS_ENTRY_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
  })

  it('still requires the parent document on a partial update', async () => {
    const { update } = buildActions()

    await expect(
      update.mapInput({ raw: { id: LINE_ID, statusEntryId: STATUS_ENTRY_ID }, ctx }),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it('still requires the full line when PUT has no id', async () => {
    const { update } = buildActions()

    await expect(
      update.mapInput({ raw: { orderId: ORDER_ID, statusEntryId: STATUS_ENTRY_ID }, ctx }),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it('keeps POST on the full create contract', async () => {
    const { create } = buildActions()

    await expect(
      create.mapInput({
        raw: { id: LINE_ID, orderId: ORDER_ID, statusEntryId: STATUS_ENTRY_ID },
        ctx,
      }),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it('keeps the previous PUT contract when updateSchema is not configured', async () => {
    const { update } = buildActions({ partialUpdates: false })

    await expect(
      update.mapInput({ raw: { id: LINE_ID, orderId: ORDER_ID, statusEntryId: STATUS_ENTRY_ID }, ctx }),
    ).rejects.toBeInstanceOf(ZodError)
    const { body } = await update.mapInput({ raw: { id: LINE_ID, ...completeLine }, ctx })
    expect(body).toMatchObject({ id: LINE_ID, ...completeLine })
    expect(
      putRequestSchema({ partialUpdates: false }).safeParse({
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        id: LINE_ID,
        orderId: ORDER_ID,
        statusEntryId: STATUS_ENTRY_ID,
      }).success,
    ).toBe(false)
  })
})

describe('makeSalesLineRoute PUT OpenAPI (#6947)', () => {
  it('documents both the id-less complete line and the id-bearing partial update', () => {
    const schema = putRequestSchema()
    expect(schema).toBeInstanceOf(z.ZodUnion)
    const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

    expect(schema.safeParse({ ...scope, ...completeLine }).success).toBe(true)
    expect(schema.safeParse({ ...scope, id: LINE_ID, orderId: ORDER_ID, statusEntryId: STATUS_ENTRY_ID }).success).toBe(true)
    expect(schema.safeParse({ ...scope, orderId: ORDER_ID, statusEntryId: STATUS_ENTRY_ID }).success).toBe(false)
    expect(schema.safeParse({ ...scope, id: LINE_ID, statusEntryId: STATUS_ENTRY_ID }).success).toBe(false)
  })
})
