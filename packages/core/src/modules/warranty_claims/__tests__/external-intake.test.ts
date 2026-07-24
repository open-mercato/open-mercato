import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ExternalClaimIntakeInput } from '../data/validators'
import {
  buildExternalClaimCreateInput,
  createAndSubmitExternalClaim,
  isUniqueViolation,
  resolveExternalReferences,
  resolveSkuProduct,
  type ExternalIntakeCommandBus,
} from '../lib/externalIntake'
import { addWarrantyMonths, computeWarrantyEntitlementPreview } from '../lib/warrantyPreview'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_CUSTOMER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555'

type LookupResolver = (
  table: string,
  where: Record<string, string>,
) => Array<Record<string, unknown>> | null | Promise<Array<Record<string, unknown>> | null>

function baseInput(overrides: Partial<ExternalClaimIntakeInput> = {}): ExternalClaimIntakeInput {
  return {
    externalRef: 'EXT-1',
    contactEmail: 'buyer@example.com',
    contactName: 'Buyer Name',
    reasonCode: 'defective',
    notes: 'External intake',
    lines: [
      {
        sku: 'SKU-1',
        faultDescription: 'Does not power on',
      },
    ],
    ...overrides,
  }
}

function makeDeps(resolver: LookupResolver) {
  const lookupRows = jest.fn(async (table: string, where: Record<string, string>, _select: string[], limit: number) => {
    const rows = await resolver(table, where)
    return rows === null ? null : rows.slice(0, limit)
  })
  return {
    lookupRows,
    deps: {
      lookupRows,
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    },
  }
}

function expectCrudHttpError(err: unknown, status: number, error: string): void {
  expect(err).toBeInstanceOf(CrudHttpError)
  expect(err).toMatchObject({ status, body: { error } })
}

async function expectCrudHttpRejection(promise: Promise<unknown>, status: number, error: string): Promise<void> {
  try {
    await promise
    throw new Error('expected promise to reject')
  } catch (err) {
    expectCrudHttpError(err, status, error)
  }
}

describe('external warranty claim intake helpers', () => {
  test('order customer mismatch fails and matching ids resolve', async () => {
    const { deps } = makeDeps((table, where) => {
      if (table === 'sales_orders') {
        return [{
          id: ORDER_ID,
          customer_entity_id: CUSTOMER_ID,
          currency_code: 'USD',
          placed_at: '2025-01-20T12:34:00.000Z',
        }]
      }
      if (table === 'customer_entities' && where.id === CUSTOMER_ID) {
        return [{ id: CUSTOMER_ID, display_name: 'Acme Distribution' }]
      }
      return []
    })

    await expectCrudHttpRejection(
      resolveExternalReferences(
        deps,
        baseInput({ orderId: ORDER_ID, customerId: OTHER_CUSTOMER_ID }),
      ),
      400,
      'Customer does not match the order',
    )

    const resolved = await resolveExternalReferences(
      deps,
      baseInput({ orderId: ORDER_ID, customerId: CUSTOMER_ID }),
    )
    expect(resolved).toMatchObject({
      orderId: ORDER_ID,
      customerId: CUSTOMER_ID,
      customerName: 'Acme Distribution',
      currencyCode: 'USD',
    })
    expect(resolved.orderPlacedAt?.toISOString()).toBe('2025-01-20T12:34:00.000Z')
  })

  test('orderNumber resolves and unresolvable orderNumber returns orderNotFound', async () => {
    const { deps } = makeDeps((table, where) => {
      if (table === 'sales_orders' && where.order_number === 'SO-100') {
        return [{ id: ORDER_ID, customer_entity_id: null, currency_code: 'EUR', placed_at: null }]
      }
      return []
    })

    await expect(resolveExternalReferences(
      deps,
      baseInput({ orderNumber: 'SO-100' }),
    )).resolves.toMatchObject({ orderId: ORDER_ID, currencyCode: 'EUR' })

    await expectCrudHttpRejection(
      resolveExternalReferences(
        deps,
        baseInput({ orderNumber: 'SO-404' }),
      ),
      400,
      'Order not found',
    )
  })

  test('order lookup unavailable (module absent) is treated as unresolvable orderNotFound', async () => {
    const { deps } = makeDeps(() => null)

    await expectCrudHttpRejection(
      resolveExternalReferences(
        deps,
        baseInput({ orderNumber: 'SO-100' }),
      ),
      400,
      'Order not found',
    )
  })

  test('unlinked path keeps customerId null and snapshots contactName', async () => {
    const { deps } = makeDeps(() => [])

    const resolved = await resolveExternalReferences(
      deps,
      baseInput({ orderId: undefined, orderNumber: null, customerId: undefined, contactName: 'Unlinked Buyer' }),
    )

    expect(resolved).toMatchObject({
      orderId: null,
      customerId: null,
      customerName: 'Unlinked Buyer',
      currencyCode: null,
      orderPlacedAt: null,
    })
  })

  test('resolveSkuProduct resolves only exact single SKU matches', async () => {
    const { deps } = makeDeps((_table, where) => {
      const sku = where.sku
      if (sku === 'ONE') return [{ id: PRODUCT_ID, title: 'Pump Assembly' }]
      if (sku === 'TWO') return [{ id: PRODUCT_ID, title: 'First' }, { id: OTHER_CUSTOMER_ID, title: 'Second' }]
      return []
    })

    await expect(resolveSkuProduct(deps, 'ONE'))
      .resolves.toEqual({ productId: PRODUCT_ID, productName: 'Pump Assembly' })
    await expect(resolveSkuProduct(deps, 'TWO'))
      .resolves.toBeNull()
    await expect(resolveSkuProduct(deps, 'ZERO'))
      .resolves.toBeNull()
  })

  test('buildExternalClaimCreateInput maps API intake defaults', () => {
    const createInput = buildExternalClaimCreateInput(
      baseInput({
        lines: [
          {
            productId: PRODUCT_ID,
            sku: 'SKU-1',
            productName: 'Pump Assembly',
            serialNumber: 'SN-1',
            faultCode: 'dead',
            faultDescription: 'Does not power on',
          },
        ],
      }),
      {
        orderId: ORDER_ID,
        customerId: CUSTOMER_ID,
        customerName: 'Acme Distribution',
        currencyCode: 'GBP',
        orderPlacedAt: new Date('2025-03-15T18:45:00.000Z'),
      },
      { defaultWarrantyMonths: 24 },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )

    expect(createInput).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      channel: 'api',
      externalRef: 'EXT-1',
      customerId: CUSTOMER_ID,
      customerName: 'Acme Distribution',
      orderId: ORDER_ID,
      currencyCode: 'GBP',
    })
    expect(createInput.lines?.[0]).toMatchObject({
      lineNo: 1,
      productId: PRODUCT_ID,
      sku: 'SKU-1',
      productName: 'Pump Assembly',
      purchaseDate: new Date('2025-03-15T00:00:00.000Z'),
      warrantyMonths: 24,
      qtyClaimed: 1,
    })
  })


  test('explicit customerId without an order resolves the customer or rejects unknown ids', async () => {
    const { deps } = makeDeps((table, where) => {
      if (table === 'customer_entities' && where.id === CUSTOMER_ID) {
        return [{ id: CUSTOMER_ID, display_name: 'Acme Distribution' }]
      }
      return []
    })

    const resolved = await resolveExternalReferences(
      deps,
      baseInput({ customerId: CUSTOMER_ID }),
    )
    expect(resolved).toMatchObject({
      orderId: null,
      customerId: CUSTOMER_ID,
      customerName: 'Acme Distribution',
    })

    await expectCrudHttpRejection(
      resolveExternalReferences(
        deps,
        baseInput({ customerId: OTHER_CUSTOMER_ID }),
      ),
      400,
      'The referenced customer could not be found.',
    )
  })

  test('createAndSubmitExternalClaim covers happy path, unique-violation replay, and submit compensation', async () => {
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    const saveFailedError = () => new Error('[internal] save failed')

    const calls: Array<{ commandId: string; input: unknown }> = []
    const happyBus: ExternalIntakeCommandBus = {
      execute: async (commandId, args) => {
        calls.push({ commandId, input: args.input })
        if (commandId === 'warranty_claims.claim.create') return { result: { claimId: ORDER_ID } }
        return { result: { claimId: ORDER_ID } }
      },
    }
    await expect(createAndSubmitExternalClaim({
      commandBus: happyBus,
      commandCtx: {},
      createInput: { organizationId: ORG_ID, tenantId: TENANT_ID, claimType: 'warranty' } as never,
      scope,
      externalRef: 'EXT-HAPPY',
      hasExistingByExternalRef: async () => false,
      saveFailedError,
    })).resolves.toEqual({ outcome: 'created', claimId: ORDER_ID })
    expect(calls.map((call) => call.commandId)).toEqual([
      'warranty_claims.claim.create',
      'warranty_claims.claim.submit',
    ])

    const uniqueViolationBus: ExternalIntakeCommandBus = {
      execute: async (commandId) => {
        if (commandId === 'warranty_claims.claim.create') throw Object.assign(new Error('duplicate'), { code: '23505' })
        throw new Error('[internal] unexpected command')
      },
    }
    await expect(createAndSubmitExternalClaim({
      commandBus: uniqueViolationBus,
      commandCtx: {},
      createInput: {} as never,
      scope,
      externalRef: 'EXT-RACE',
      hasExistingByExternalRef: async (externalRef) => externalRef === 'EXT-RACE',
      saveFailedError,
    })).resolves.toEqual({ outcome: 'existing' })

    await expect(createAndSubmitExternalClaim({
      commandBus: uniqueViolationBus,
      commandCtx: {},
      createInput: {} as never,
      scope,
      externalRef: 'EXT-NO-WINNER',
      hasExistingByExternalRef: async () => false,
      saveFailedError,
    })).rejects.toMatchObject({ code: '23505' })

    const compensationCalls: string[] = []
    const failingSubmitBus: ExternalIntakeCommandBus = {
      execute: async (commandId, args) => {
        compensationCalls.push(commandId)
        if (commandId === 'warranty_claims.claim.create') return { result: { claimId: PRODUCT_ID } }
        if (commandId === 'warranty_claims.claim.submit') throw new Error('[internal] submit rejected')
        expect(args.input).toMatchObject({ id: PRODUCT_ID, organizationId: ORG_ID, tenantId: TENANT_ID })
        return { result: { claimId: PRODUCT_ID } }
      },
    }
    await expect(createAndSubmitExternalClaim({
      commandBus: failingSubmitBus,
      commandCtx: {},
      createInput: {} as never,
      scope,
      externalRef: 'EXT-COMP',
      hasExistingByExternalRef: async () => false,
      saveFailedError,
    })).rejects.toThrow('[internal] submit rejected')
    expect(compensationCalls).toEqual([
      'warranty_claims.claim.create',
      'warranty_claims.claim.submit',
      'warranty_claims.claim.delete',
    ])
  })

  test('computeWarrantyEntitlementPreview handles unknowns, boundaries, and month-end clamps', () => {
    const now = new Date('2026-07-05T00:00:00.000Z')
    expect(computeWarrantyEntitlementPreview(null, 12, now)).toBe('unknown')
    expect(computeWarrantyEntitlementPreview(new Date('invalid'), 12, now)).toBe('unknown')
    expect(computeWarrantyEntitlementPreview(new Date('2026-01-01T00:00:00.000Z'), null, now)).toBe('unknown')
    expect(computeWarrantyEntitlementPreview(new Date('2026-01-01T00:00:00.000Z'), 12, now)).toBe('in_warranty')
    expect(computeWarrantyEntitlementPreview(new Date('2024-01-01T00:00:00.000Z'), 12, now)).toBe('out_of_warranty')
    expect(computeWarrantyEntitlementPreview(new Date('2025-07-05T00:00:00.000Z'), 12, now)).toBe('in_warranty')
    expect(addWarrantyMonths(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(addWarrantyMonths(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2024-02-29T00:00:00.000Z')
  })

  test('isUniqueViolation detects direct and nested postgres 23505 errors only', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ driverError: { sqlState: '23505' } })).toBe(true)
    expect(isUniqueViolation({ driverError: { code: '23503' } })).toBe(false)
    expect(isUniqueViolation(new Error('nope'))).toBe(false)
  })
})
