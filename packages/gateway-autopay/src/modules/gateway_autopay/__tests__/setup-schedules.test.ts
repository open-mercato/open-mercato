import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import {
  AUTOPAY_STATUS_POLLER_BATCH_LIMIT,
  AUTOPAY_STATUS_POLLER_INTERVAL,
  AUTOPAY_STATUS_POLLER_QUEUE,
  buildStatusPollerScheduleId,
} from '../lib/status-poller-schedule'

const reportAutopayError = jest.fn()

jest.mock('../lib/error-reporting', () => ({
  reportAutopayError: (...args: unknown[]) => reportAutopayError(...args),
}))

jest.mock('../lib/preset', () => ({
  applyAutopayEnvPreset: async () => ({ status: 'skipped', reason: 'test' }),
}))

type ScheduleRegistration = Record<string, unknown> & { id: string }

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

async function loadSetup() {
  const { setup } = await import('../setup')
  if (!setup.seedDefaults || !setup.onOrganizationCreated) {
    throw new Error('[internal] Autopay setup hooks are missing')
  }
  return { seedDefaults: setup.seedDefaults, onOrganizationCreated: setup.onOrganizationCreated }
}

describe('gateway_autopay setup schedules', () => {
  beforeEach(() => {
    reportAutopayError.mockClear()
  })

  it('registers one organization-scoped reconciliation schedule on this module own queue', async () => {
    const { context, register } = createSetupContext({})
    const { seedDefaults } = await loadSetup()

    await seedDefaults(context)

    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: buildStatusPollerScheduleId({ tenantId: 'tenant-1', organizationId: 'organization-1' }),
      organizationId: 'organization-1',
      tenantId: 'tenant-1',
      scopeType: 'organization',
      scheduleType: 'interval',
      scheduleValue: AUTOPAY_STATUS_POLLER_INTERVAL,
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: AUTOPAY_STATUS_POLLER_QUEUE,
      targetPayload: { limit: AUTOPAY_STATUS_POLLER_BATCH_LIMIT },
      sourceType: 'module',
      sourceModule: 'gateway_autopay',
      isEnabled: true,
    }))
  })

  it('never puts tenant scope or a provider key into the schedule payload', async () => {
    const { context, register } = createSetupContext({})
    const { seedDefaults } = await loadSetup()

    await seedDefaults(context)

    const registration = register.mock.calls[0][0] as ScheduleRegistration
    expect(registration.targetPayload).toEqual({ limit: AUTOPAY_STATUS_POLLER_BATCH_LIMIT })
  })

  it('registers the same schedule for an organization created later', async () => {
    const { context, register } = createSetupContext({ organizationId: 'organization-2' })
    const { onOrganizationCreated } = await loadSetup()

    await onOrganizationCreated(context)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: buildStatusPollerScheduleId({ tenantId: 'tenant-1', organizationId: 'organization-2' }),
      organizationId: 'organization-2',
    }))
  })

  it('uses stable IDs that stay distinct across organizations in one tenant', async () => {
    const first = createSetupContext({ organizationId: 'organization-1' })
    const second = createSetupContext({ organizationId: 'organization-2' })
    const repeated = createSetupContext({ organizationId: 'organization-1' })
    const { seedDefaults } = await loadSetup()

    await seedDefaults(first.context)
    await seedDefaults(second.context)
    await seedDefaults(repeated.context)

    const firstId = (first.register.mock.calls[0][0] as ScheduleRegistration).id
    const secondId = (second.register.mock.calls[0][0] as ScheduleRegistration).id
    const repeatedId = (repeated.register.mock.calls[0][0] as ScheduleRegistration).id
    expect(firstId).not.toBe(secondId)
    expect(repeatedId).toBe(firstId)
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('skips registration when the optional scheduler module is absent', async () => {
    const { context, register, resolve } = createSetupContext({ hasScheduler: false })
    const { seedDefaults } = await loadSetup()

    await seedDefaults(context)

    expect(register).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(reportAutopayError).not.toHaveBeenCalled()
  })

  it('reports a registration failure without failing tenant setup', async () => {
    const failure = new Error('[internal] scheduler unavailable')
    const { context } = createSetupContext({
      register: async () => {
        throw failure
      },
    })
    const { seedDefaults } = await loadSetup()

    await expect(seedDefaults(context)).resolves.toBeUndefined()

    expect(reportAutopayError).toHaveBeenCalledWith(failure, 'gateway_autopay.schedule_registration_failed')
  })
})
