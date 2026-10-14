/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

import '../transactions'

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'

function makeContext(currencyDecimalPlaces: number | null) {
  const created: Array<Record<string, unknown>> = []
  const tx = {
    findOne: jest.fn(async () => ({
      id: LINK_ID,
      status: 'active',
      slug: 'link',
      templateId: null,
      gatewayProviderKey: 'stripe',
      isLocked: true,
    })),
    getConnection: () => ({ execute: jest.fn(async () => [{ id: LINK_ID }]) }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      const record = { id: 'tx-1', ...data }
      created.push(record)
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  const em = { transactional: async (run: (manager: typeof tx) => Promise<unknown>) => run(tx) }
  const services: Record<string, unknown> = {
    em,
    currencyPrecisionService: { getDecimalPlaces: async () => currencyDecimalPlaces },
  }
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (!(name in services)) throw new Error(`[internal] missing ${name}`)
        return services[name]
      },
    },
  } as unknown as CommandRuntimeContext
  return { ctx, created }
}

function input(amount: string) {
  return {
    linkId: LINK_ID,
    amount,
    currencyCode: 'USD',
    idempotencyKey: 'key-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
  }
}

describe('checkout.transaction.create charged amount', () => {
  const handler = commandRegistry.get('checkout.transaction.create')!

  it('stores the amount rounded to the currency precision the gateway charges', async () => {
    const { ctx, created } = makeContext(2)
    await handler.execute(input('10.004'), ctx)
    expect(created[0]?.amount).toBe('10')
  })

  it('keeps every digit for a high-precision currency', async () => {
    const { ctx, created } = makeContext(18)
    await handler.execute(input('0.000000000000000001'), ctx)
    expect(created[0]?.amount).toBe('0.000000000000000001')
  })
})
