import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS, runStaffMutationGuards } from '../guards'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

function containerWithoutLegacyGuard() {
  return {
    hasRegistration: () => false,
    resolve: () => null,
  } as never
}

function guardInput(overrides: Partial<MutationGuardInput> = {}): MutationGuardInput {
  return {
    tenantId,
    organizationId,
    userId,
    resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeEntry,
    resourceId: null,
    operation: 'update',
    requestMethod: 'POST',
    requestHeaders: new Headers(),
    mutationPayload: { durationMinutes: 900 },
    ...overrides,
  }
}

function blockingGuard(): MutationGuard {
  return {
    id: 'test.time-entry-cap',
    targetEntity: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeEntry,
    operations: ['create', 'update', 'delete'],
    async validate() {
      return { ok: false, status: 409, message: 'Entry too long' }
    },
  }
}

describe('runStaffMutationGuards — registry guards on the custom time-tracking routes', () => {
  afterEach(() => {
    registerMutationGuards([])
  })

  it('runs a module-registered guard even when no legacy DI guard is bridged', async () => {
    registerMutationGuards([{ moduleId: 'test', guards: [blockingGuard()] }])

    const result = await runStaffMutationGuards(containerWithoutLegacyGuard(), guardInput(), [])

    expect(result.ok).toBe(false)
    expect(result.errorStatus).toBe(409)
    expect(result.errorBody).toMatchObject({ error: 'Entry too long', guardId: 'test.time-entry-cap' })
  })

  it('passes through when no guard targets the resource kind', async () => {
    registerMutationGuards([{ moduleId: 'test', guards: [blockingGuard()] }])

    const result = await runStaffMutationGuards(
      containerWithoutLegacyGuard(),
      guardInput({ resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeReport }),
      [],
    )

    expect(result.ok).toBe(true)
    expect(result.afterSuccessCallbacks).toEqual([])
  })

  it('returns the empty pass-through result when nothing is registered at all', async () => {
    registerMutationGuards([])

    const result = await runStaffMutationGuards(containerWithoutLegacyGuard(), guardInput(), [])

    expect(result).toEqual({ ok: true, afterSuccessCallbacks: [] })
  })

  it('honours the feature gate on a registered guard', async () => {
    registerMutationGuards([
      {
        moduleId: 'test',
        guards: [{ ...blockingGuard(), features: ['test.gate'] }],
      },
    ])

    const denied = await runStaffMutationGuards(containerWithoutLegacyGuard(), guardInput(), [])
    expect(denied.ok).toBe(true)

    const allowed = await runStaffMutationGuards(containerWithoutLegacyGuard(), guardInput(), ['test.gate'])
    expect(allowed.ok).toBe(false)
  })
})
