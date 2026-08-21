import { describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import { CHECKOUT_EXPIRY_QUEUE } from '../workers/transaction-expiry.worker'

const ensureCheckoutFieldsetsAndDefinitions = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../seed/customFields', () => ({
  ensureCheckoutFieldsetsAndDefinitions: (...args: unknown[]) => ensureCheckoutFieldsetsAndDefinitions(...args),
}))

type ScheduleRegistration = {
  id: string
  organizationId: string
  tenantId: string
  scopeType: string
  targetQueue: string
}

function createSetupContext(options: {
  tenantId?: string
  organizationId?: string
  hasScheduler?: boolean
  register?: (registration: ScheduleRegistration) => Promise<void>
}) {
  const register = jest.fn(options.register ?? (async () => undefined))
  const resolve = jest.fn((name: string) => {
    if (name === 'schedulerService') return { register }
    throw new Error(`[internal] Missing dependency: ${name}`)
  })
  const container = {
    hasRegistration: jest.fn(() => options.hasScheduler ?? true),
    resolve,
  }
  const context: InitSetupContext = {
    tenantId: options.tenantId ?? 'tenant-1',
    organizationId: options.organizationId ?? 'organization-1',
    em: {} as EntityManager,
    container: container as unknown as AwilixContainer,
  }
  return { context, register, resolve }
}

async function seedDefaults(context: InitSetupContext): Promise<void> {
  const { setup } = await import('../setup')
  if (!setup.seedDefaults) throw new Error('[internal] Checkout seedDefaults hook is missing')
  await setup.seedDefaults(context)
}

describe('checkout setup schedules', () => {
  it('registers one organization-scoped transaction-expiry schedule', async () => {
    const { context, register } = createSetupContext({})

    await seedDefaults(context)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'organization-1',
      tenantId: 'tenant-1',
      scopeType: 'organization',
      targetQueue: CHECKOUT_EXPIRY_QUEUE,
    }))
  })

  it('uses stable IDs that remain distinct across organizations in one tenant', async () => {
    const first = createSetupContext({ organizationId: 'organization-1' })
    const second = createSetupContext({ organizationId: 'organization-2' })
    const repeated = createSetupContext({ organizationId: 'organization-1' })

    await seedDefaults(first.context)
    await seedDefaults(second.context)
    await seedDefaults(repeated.context)

    const firstId = first.register.mock.calls[0][0].id
    const secondId = second.register.mock.calls[0][0].id
    const repeatedId = repeated.register.mock.calls[0][0].id
    expect(firstId).not.toBe(secondId)
    expect(repeatedId).toBe(firstId)
  })

  it('skips schedule registration when the optional scheduler module is absent', async () => {
    const { context, register, resolve } = createSetupContext({ hasScheduler: false })

    await seedDefaults(context)

    expect(register).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('propagates scheduler registration failures', async () => {
    const { context } = createSetupContext({
      register: async () => {
        throw new Error('[internal] scheduler unavailable')
      },
    })

    await expect(seedDefaults(context)).rejects.toThrow('[internal] scheduler unavailable')
  })
})
