/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { shippingMethodCreateSchema, shippingMethodUpdateSchema } from '../../data/validators'
import { withExactShippingMethodInput } from '../../lib/exactAmountFields'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_shipping_method: 'sales.sales_shipping_method',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const SHIPPING_METHOD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LONG_NET = '1234567890.123456789012345'
const LONG_GROSS = '1518518504.851851850485185'

type PersistedRecord = Record<string, unknown>

function buildHarness(existing: PersistedRecord | null = null) {
  const persisted: PersistedRecord[] = []
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: PersistedRecord) => ({ id: SHIPPING_METHOD_ID, ...data }),
    persist: (entity: PersistedRecord) => {
      persisted.push(entity)
    },
    findOne: async () => existing,
    flush: async () => undefined,
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ setCustomFields: jest.fn(async () => undefined) }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { persisted, ctx }
}

function getHandler(commandId: string) {
  const handler = commandRegistry.get<unknown, Record<string, unknown>>(commandId)
  expect(handler).toBeTruthy()
  return handler!
}

describe('shipping method commands keep exact base rates', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it('stores every digit of base rates sent as strings straight to the command', async () => {
    const { persisted, ctx } = buildHarness()

    await getHandler('sales.shipping-methods.create').execute(
      {
        organizationId: TEST_ORG_ID,
        tenantId: TEST_TENANT_ID,
        name: 'Courier',
        code: 'courier',
        baseRateNet: LONG_NET,
        baseRateGross: LONG_GROSS,
      },
      ctx,
    )

    expect(persisted[0]?.baseRateNet).toBe(LONG_NET)
    expect(persisted[0]?.baseRateGross).toBe(LONG_GROSS)
  })

  it('stores every digit of base rates the API route already parsed into numbers', async () => {
    const { persisted, ctx } = buildHarness()
    const body = {
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      name: 'Courier',
      code: 'courier',
      baseRateNet: LONG_NET,
      baseRateGross: LONG_GROSS,
    }
    const routeInput = withExactShippingMethodInput(shippingMethodCreateSchema.parse(body), body)
    expect(typeof routeInput.baseRateNet).toBe('number')

    await getHandler('sales.shipping-methods.create').execute(routeInput, ctx)

    expect(persisted[0]?.baseRateNet).toBe(LONG_NET)
    expect(persisted[0]?.baseRateGross).toBe(LONG_GROSS)
  })

  it('updates base rates with every digit and leaves an unsent rate untouched', async () => {
    const existing: PersistedRecord = {
      id: SHIPPING_METHOD_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      name: 'Courier',
      code: 'courier',
      baseRateNet: '10',
      baseRateGross: '12.3',
      metadata: null,
    }
    const { ctx } = buildHarness(existing)
    const body = {
      id: SHIPPING_METHOD_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      baseRateNet: LONG_NET,
    }
    const routeInput = withExactShippingMethodInput(shippingMethodUpdateSchema.parse(body), body)

    await getHandler('sales.shipping-methods.update').execute(routeInput, ctx)

    expect(existing.baseRateNet).toBe(LONG_NET)
    expect(existing.baseRateGross).toBe('12.3')
  })
})
