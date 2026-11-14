/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'
const TEMPLATE_ID = '123e4567-e89b-12d3-a456-426614174020'
const FLUSH_SENTINEL = 'FLUSH_REACHED'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../lib/gatewayProviderAvailability', () => ({
  ensureGatewayProviderConfigured: jest.fn(async () => undefined),
  getGatewayProviderConfigurationMessageKey: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  setCustomFieldsIfAny: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
  buildCustomFieldResetMap: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

import '../links'
import '../templates'

const CURRENCY_DECIMALS: Record<string, number> = { USD: 2, JPY: 0, ETH: 18 }

function makeContext() {
  const created: Array<Record<string, unknown>> = []
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return { id: 'created-1', ...data }
    }),
    persist: jest.fn(),
    findOne: jest.fn(async () => null),
    flush: jest.fn(async () => {
      throw new Error(FLUSH_SENTINEL)
    }),
  }
  const services: Record<string, unknown> = {
    em,
    dataEngine: {},
    paymentGatewayDescriptorService: {},
    currencyPrecisionService: {
      getDecimalPlaces: async ({ code }: { code: string }) => CURRENCY_DECIMALS[code] ?? null,
    },
  }
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (!(name in services)) throw new Error(`[internal] missing ${name}`)
        return services[name]
      },
    },
    auth: { orgId: ORG_ID, tenantId: TENANT_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
  return { ctx, created }
}

function storedRecord(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Pay link',
    title: null,
    slug: 'pay-link',
    templateId: null,
    status: 'draft',
    isLocked: false,
    pricingMode: 'fixed',
    gatewayProviderKey: 'mock',
    gatewaySettings: {},
    fixedPriceAmount: '10',
    fixedPriceCurrencyCode: 'USD',
    fixedPriceOriginalAmount: null,
    customAmountMin: null,
    customAmountMax: null,
    customAmountCurrencyCode: null,
    priceListItems: null,
    passwordHash: null,
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  }
}

async function run(commandId: string, input: Record<string, unknown>, ctx: CommandRuntimeContext) {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] command ${commandId} not registered`)
  await expect(handler.execute(input, ctx)).rejects.toThrow(FLUSH_SENTINEL)
}

const customAmountInput = {
  name: 'Donation',
  pricingMode: 'custom_amount',
  customAmountMin: '10.001',
  customAmountMax: '10.005',
  customAmountCurrencyCode: 'USD',
  gatewayProviderKey: 'mock',
}

describe('configured checkout amounts are rounded to the currency decimals', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rounds custom amount bounds on template create (USD)', async () => {
    const { ctx, created } = makeContext()
    await run('checkout.template.create', customAmountInput, ctx)
    expect(created[0]).toMatchObject({ customAmountMin: '10', customAmountMax: '10.01' })
  })

  it('rounds the fixed price and price-list items on link create (JPY)', async () => {
    const { ctx, created } = makeContext()
    await run('checkout.link.create', {
      name: 'Yen link',
      pricingMode: 'price_list',
      priceListItems: [{ id: 'a', description: 'A', amount: '99.5', currencyCode: 'JPY' }],
      gatewayProviderKey: 'mock',
    }, ctx)
    expect(created[0]?.priceListItems).toEqual([
      { id: 'a', description: 'A', amount: 100, amountExact: '100', currencyCode: 'JPY' },
    ])
  })

  it('keeps every digit for an 18-decimal currency on link create', async () => {
    const { ctx, created } = makeContext()
    await run('checkout.link.create', {
      name: 'ETH link',
      pricingMode: 'fixed',
      fixedPriceAmount: '1234.567890123456789012',
      fixedPriceCurrencyCode: 'ETH',
      gatewayProviderKey: 'mock',
    }, ctx)
    expect(created[0]).toMatchObject({ fixedPriceAmount: '1234.567890123456789012' })
  })

  it('rounds a new fixed price on link update using the stored currency', async () => {
    const { ctx } = makeContext()
    const link = storedRecord({ id: LINK_ID })
    mockFindOneWithDecryption.mockResolvedValue(link)
    await run('checkout.link.update', { id: LINK_ID, fixedPriceAmount: '10.005' }, ctx)
    expect(link.fixedPriceAmount).toBe('10.01')
  })

  it('rounds custom amount bounds and price-list items on template update', async () => {
    const { ctx } = makeContext()
    const template = storedRecord({ id: TEMPLATE_ID, pricingMode: 'price_list', fixedPriceAmount: null, fixedPriceCurrencyCode: null })
    mockFindOneWithDecryption.mockResolvedValue(template)
    await run('checkout.template.update', {
      id: TEMPLATE_ID,
      pricingMode: 'price_list',
      priceListItems: [{ id: 'a', description: 'A', amount: '10.005', currencyCode: 'USD' }],
    }, ctx)
    expect(template.priceListItems).toEqual([
      { id: 'a', description: 'A', amount: 10.01, amountExact: '10.01', currencyCode: 'USD' },
    ])
  })
})
