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

/**
 * M-2. `runMutationGuards` drops any guard whose declared `features` the caller does
 * not hold, so the grant list decides whether a feature-gated guard runs at all.
 * This used to arrive as `resolveUserFeatures(auth)`, reading an `auth.features`
 * field `AuthContext` does not have — always `[]`. The result was an asymmetry:
 * a third-party guard declaring `features: ['record_locks.enforce']` fired on the
 * `makeCrudRoute` resources, where the factory asks RBAC, and was silently skipped
 * on `/time-entries/bulk`, the timer transitions, segments, tag assignments and
 * report close/unlock. The grants are now resolved from the container.
 */
describe('runStaffMutationGuards resolves the caller grants itself', () => {
  function containerWithGrants(grantedFeatures: string[]) {
    const rbac = {
      getGrantedFeatures: jest.fn().mockResolvedValue(grantedFeatures),
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
    }
    return {
      rbac,
      container: {
        hasRegistration: () => false,
        resolve: (name: string) => (name === 'rbacService' ? rbac : null),
      } as never,
    }
  }

  afterEach(() => {
    registerMutationGuards([])
  })

  it('runs a feature-gated guard on a custom route when RBAC grants the feature', async () => {
    registerMutationGuards([
      { moduleId: 'test', guards: [{ ...blockingGuard(), features: ['record_locks.enforce'] }] },
    ])
    const { rbac, container } = containerWithGrants(['record_locks.enforce'])

    const result = await runStaffMutationGuards(container, guardInput())

    expect(result.ok).toBe(false)
    expect(result.errorStatus).toBe(409)
    expect(rbac.getGrantedFeatures).toHaveBeenCalledWith(userId, { tenantId, organizationId })
  })

  it('skips the same guard when RBAC does not grant the feature', async () => {
    registerMutationGuards([
      { moduleId: 'test', guards: [{ ...blockingGuard(), features: ['record_locks.enforce'] }] },
    ])
    const { container } = containerWithGrants(['staff.timesheets.view'])

    await expect(runStaffMutationGuards(container, guardInput())).resolves.toMatchObject({ ok: true })
  })

  it('honours a wildcard grant, the way every other feature-gated surface does', async () => {
    registerMutationGuards([
      { moduleId: 'test', guards: [{ ...blockingGuard(), features: ['record_locks.enforce'] }] },
    ])
    const { container } = containerWithGrants(['record_locks.*'])

    await expect(runStaffMutationGuards(container, guardInput())).resolves.toMatchObject({ ok: false })
  })

  it('fails closed when the grant list cannot be read', async () => {
    registerMutationGuards([
      { moduleId: 'test', guards: [{ ...blockingGuard(), features: ['record_locks.enforce'] }] },
    ])
    const container = {
      hasRegistration: () => false,
      resolve: (name: string) =>
        name === 'rbacService'
          ? {
              getGrantedFeatures: jest.fn().mockRejectedValue(new Error('[internal] rbac down')),
              userHasAllFeatures: jest.fn().mockResolvedValue(true),
            }
          : null,
    } as never

    await expect(runStaffMutationGuards(container, guardInput())).resolves.toMatchObject({ ok: true })
  })

  it('leaves an ungated guard running whatever RBAC says', async () => {
    registerMutationGuards([{ moduleId: 'test', guards: [blockingGuard()] }])
    const { container } = containerWithGrants([])

    await expect(runStaffMutationGuards(container, guardInput())).resolves.toMatchObject({ ok: false })
  })
})
