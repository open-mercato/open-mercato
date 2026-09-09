/** @jest-environment node */
/**
 * Registering the bulk-complete outbox dispatcher as a scheduler target.
 *
 * Two constraints shape this and both are asserted here rather than described:
 *
 * 1. `onTenantCreated` receives an `EntityManager` and NO container, so a
 *    scheduler target can only be registered from `seedDefaults`.
 * 2. `SchedulerService.register` enforces a per-tenant active-schedule cap and
 *    rejects with a 422 once it is reached. Tenant initialization must not fail
 *    because an optional recovery tick could not be registered, so the failure has
 *    to degrade to a logged warning.
 */
const installCustomEntitiesFromModules = jest.fn(async () => ({}))
const seedExampleTodos = jest.fn(async () => true)

jest.mock('@open-mercato/core/modules/entities/lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: (...args: unknown[]) =>
    installCustomEntitiesFromModules(...(args as [])),
}))

jest.mock('../cli', () => ({
  seedExampleTodos: (...args: unknown[]) => seedExampleTodos(...(args as [])),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import setup, { registerTodoBulkDispatchSchedule } from '../setup'
import { EXAMPLE_TODO_BULK_DISPATCH_QUEUE } from '../lib/todoBulkComplete'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const TENANT_B = '00000000-0000-4000-8000-00000000000b'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'

const em = { name: 'em' } as unknown as EntityManager

function createContainer(options: {
  withScheduler?: boolean
  register?: jest.Mock
} = {}) {
  const withScheduler = options.withScheduler !== false
  const register = options.register ?? jest.fn(async () => undefined)
  const container = {
    hasRegistration: (token: string) => (token === 'schedulerService' ? withScheduler : true),
    resolve: (token: string) => {
      if (token === 'schedulerService') return { register }
      if (token === 'dataEngine') return { createCustomEntityRecord: jest.fn(async () => ({ id: 'r' })) }
      throw new Error(`[internal] unexpected token ${token}`)
    },
  }
  return { container: container as unknown as AwilixContainer, register }
}

describe('registerTodoBulkDispatchSchedule', () => {
  it('registers an organization-scoped interval target pointing at the dispatch queue', async () => {
    const { container, register } = createContainer()

    const registered = await registerTodoBulkDispatchSchedule(container, {
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    })

    expect(registered).toBe(true)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toMatchObject({
      scopeType: 'organization',
      tenantId: TENANT_A,
      organizationId: ORG_A1,
      scheduleType: 'interval',
      targetType: 'queue',
      targetQueue: EXAMPLE_TODO_BULK_DISPATCH_QUEUE,
      targetPayload: { tenantId: TENANT_A, organizationId: ORG_A1 },
      sourceType: 'module',
      sourceModule: 'example',
      isEnabled: true,
    })
  })

  it('derives a stable id so repeated setup runs upsert one schedule per scope', async () => {
    const { container, register } = createContainer()

    await registerTodoBulkDispatchSchedule(container, { tenantId: TENANT_A, organizationId: ORG_A1 })
    await registerTodoBulkDispatchSchedule(container, { tenantId: TENANT_A, organizationId: ORG_A1 })
    await registerTodoBulkDispatchSchedule(container, { tenantId: TENANT_B, organizationId: ORG_A1 })

    const [first, second, other] = register.mock.calls.map((call) => call[0].id as string)
    expect(second).toBe(first)
    expect(other).not.toBe(first)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('no-ops when the scheduler module is not installed', async () => {
    const { container, register } = createContainer({ withScheduler: false })

    await expect(registerTodoBulkDispatchSchedule(container, {
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    })).resolves.toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('no-ops without a container at all', async () => {
    await expect(registerTodoBulkDispatchSchedule(undefined, {
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    })).resolves.toBe(false)
  })

  it('propagates a registration failure to its caller so the caller decides', async () => {
    const register = jest.fn(async () => {
      throw new Error('Active scheduled job limit reached for this tenant (100).')
    })
    const { container } = createContainer({ register })

    await expect(registerTodoBulkDispatchSchedule(container, {
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    })).rejects.toThrow('Active scheduled job limit reached')
  })
})

describe('setup.seedDefaults', () => {
  it('registers the dispatch schedule as part of the always-running hook', async () => {
    const { container, register } = createContainer()

    await setup.seedDefaults!({
      em,
      container,
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    } as InitSetupContext)

    expect(register).toHaveBeenCalledTimes(1)
  })

  it('completes tenant initialization even when the scheduler rejects the registration', async () => {
    const register = jest.fn(async () => {
      throw new Error('Active scheduled job limit reached for this tenant (100).')
    })
    const { container } = createContainer({ register })

    // The assertion that matters is that this does NOT reject: a 422 from the
    // active-schedule cap must never abort `mercato init`.
    await expect(setup.seedDefaults!({
      em,
      container,
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    } as InitSetupContext)).resolves.toBeUndefined()
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('does not register the schedule from onTenantCreated', async () => {
    // The real, failable invariant: registration lives in `seedDefaults` (which receives a
    // container) and must NOT move into `onTenantCreated` (which does not).
    //
    // Two earlier attempts at this test were VACUOUS and both were caught by probing them.
    // The first built a local context literal without a container and asserted the container
    // was absent — asserting the absence of a key it had itself declined to write; adding
    // `container?: unknown` to the real `TenantSetupContext` left it green. The second used
    // `@ts-expect-error`, which the jest transform does not fail on for an unused directive,
    // so that was green too. This version calls the hook and observes the side effect, which
    // a mutation can actually break.
    const register = jest.fn(async () => {})
    const { container } = createContainer({ register })

    await expect(setup.onTenantCreated!({
      em,
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    } as never)).resolves.toBeUndefined()

    expect(register).not.toHaveBeenCalled()

    // …and the hook that DOES own it still does, so this cannot pass by nothing registering.
    await setup.seedDefaults!({ em, container, tenantId: TENANT_A, organizationId: ORG_A1 } as InitSetupContext)
    expect(register).toHaveBeenCalledTimes(1)
  })
})
