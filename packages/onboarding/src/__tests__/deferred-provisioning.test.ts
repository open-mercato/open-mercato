const seedExamples = jest.fn(async () => {
  await new Promise((resolve) => setImmediate(resolve))
})
const flattenSystemEntityIds = jest.fn(() => ['catalog:product'])
const sendWorkspaceReadyEmail = jest.fn(async () => true)
const emitEvent = jest.fn(async () => {})

type ClaimState = {
  status: string
  preparationStartedAt: Date | null
  preparationCompletedAt: Date | null
}

const claimState: ClaimState = {
  status: 'completed',
  preparationStartedAt: null,
  preparationCompletedAt: null,
}

const claimPreparation = jest.fn(async (_requestId: string, claimedAt: Date, staleBefore: Date) => {
  if (claimState.status !== 'completed') return false
  if (claimState.preparationCompletedAt) return false
  if (claimState.preparationStartedAt && claimState.preparationStartedAt.getTime() >= staleBefore.getTime()) {
    return false
  }
  claimState.preparationStartedAt = claimedAt
  return true
})

const renewPreparation = jest.fn(async (_requestId: string, renewedAt: Date) => {
  if (claimState.status !== 'completed') return false
  if (claimState.preparationCompletedAt) return false
  if (!claimState.preparationStartedAt) return false
  claimState.preparationStartedAt = renewedAt
  return true
})

const findById = jest.fn(async (id: string) => ({
  id,
  status: claimState.status,
  preparationCompletedAt: claimState.preparationCompletedAt,
}))

const markPreparationCompleted = jest.fn(async (_request: unknown, completedAt: Date) => {
  claimState.preparationCompletedAt = completedAt
  claimState.preparationStartedAt = null
})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return {}
      if (name === 'eventBus') return { emitEvent }
      throw new Error(`unexpected resolve(${name})`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => [{ id: 'catalog', setup: { seedExamples } }],
}))

jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  flattenSystemEntityIds: (...args: unknown[]) => flattenSystemEntityIds(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({}),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail: (...args: unknown[]) => sendWorkspaceReadyEmail(...(args as [])),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    claimPreparation,
    renewPreparation,
    findById,
    markPreparationCompleted,
  })),
}))

import { runDeferredProvisioning } from '@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning'

const RUN_ARGS = {
  requestId: 'req-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
}

const REINDEX_ENTITIES = ['catalog:product', 'sales:order', 'customers:customer']

describe('runDeferredProvisioning single-flight claim', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    jest.clearAllMocks()
    claimState.status = 'completed'
    claimState.preparationStartedAt = null
    claimState.preparationCompletedAt = null
    sendWorkspaceReadyEmail.mockResolvedValue(true)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('runs the provisioning chain only once when triggered concurrently by status polls (demo pool-exhaustion repro)', async () => {
    // Repro for the 2026-06-11 demo outage: the preparing page polls
    // /onboarding/status every ~1s and each poll scheduled a FULL
    // runDeferredProvisioning chain until preparationCompletedAt was flushed.
    // Concurrent triggers must collapse into exactly one run.
    await Promise.all([
      runDeferredProvisioning(RUN_ARGS),
      runDeferredProvisioning(RUN_ARGS),
      runDeferredProvisioning(RUN_ARGS),
    ])

    expect(seedExamples).toHaveBeenCalledTimes(1)
    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(sendWorkspaceReadyEmail).toHaveBeenCalledTimes(1)
  })

  it('does not run any heavy work when preparation already completed', async () => {
    claimState.preparationCompletedAt = new Date()

    await runDeferredProvisioning(RUN_ARGS)

    expect(seedExamples).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(sendWorkspaceReadyEmail).not.toHaveBeenCalled()
  })

  it('re-claims and recovers when a previous claim went stale', async () => {
    claimState.preparationStartedAt = new Date(Date.now() - 20 * 60 * 1000)

    await runDeferredProvisioning(RUN_ARGS)

    expect(seedExamples).toHaveBeenCalledTimes(1)
    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
  })

  it('renews the lease while working so a slow run never looks stale', async () => {
    await runDeferredProvisioning(RUN_ARGS)

    expect(renewPreparation).toHaveBeenCalled()
    expect(renewPreparation.mock.invocationCallOrder[0]).toBeLessThan(
      markPreparationCompleted.mock.invocationCallOrder[0],
    )
  })

  it('does not complete a request that was re-submitted (reset to pending) mid-chain', async () => {
    // A user can re-onboard the same email while an old chain is still running:
    // createOrUpdateRequest resets the request to pending. The stale chain must
    // not mark THAT request prepared — the new flow owns deferred provisioning.
    findById.mockImplementationOnce(async (id: string) => ({
      id,
      status: 'pending',
      preparationCompletedAt: null,
    }))

    await runDeferredProvisioning(RUN_ARGS)

    expect(markPreparationCompleted).not.toHaveBeenCalled()
  })

  it('enqueues the query-index rebuild as durable per-entity jobs BEFORE marking ready (no inline reindex)', async () => {
    // The workspace is marked ready as soon as the rebuild is QUEUED rather than
    // after a multi-minute inline force reindex (the demo stall). Each entity is
    // a persistent query_index.reindex job so it survives a worker/process
    // restart, and enqueuing before the completion gate keeps a death-before-
    // queueing recoverable (preparationCompletedAt stays unset → stale reclaim
    // re-enqueues; a repeated force reindex is harmless).
    flattenSystemEntityIds.mockReturnValueOnce(REINDEX_ENTITIES)

    await runDeferredProvisioning(RUN_ARGS)

    expect(emitEvent).toHaveBeenCalledTimes(REINDEX_ENTITIES.length)
    // Tenant-wide rebuild — NO organizationId. toContainEqual is a deep match,
    // so an accidental org-narrowing of the payload fails here: org-scoping
    // would silently drop organization_id IS NULL rows and org-derived
    // entities (e.g. directory:organization) that the prior inline rebuild
    // covered.
    const emittedPayloads = emitEvent.mock.calls.map((call) => call[1])
    for (const entityType of REINDEX_ENTITIES) {
      expect(emittedPayloads).toContainEqual({
        entityType,
        tenantId: RUN_ARGS.tenantId,
        force: true,
      })
      expect(emitEvent).toHaveBeenCalledWith(
        'query_index.reindex',
        expect.objectContaining({ entityType }),
        { persistent: true },
      )
    }
    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
    expect(emitEvent.mock.invocationCallOrder[0]).toBeLessThan(
      markPreparationCompleted.mock.invocationCallOrder[0],
    )
  })

  it('enqueues the rebuild and marks ready even when the ready email fails', async () => {
    // #2954's contract: post-provisioning steps are non-fatal. The email is sent
    // AFTER the rebuild is queued and the workspace is marked ready, so a
    // transient SMTP failure can never abort provisioning.
    sendWorkspaceReadyEmail.mockRejectedValue(new Error('smtp down'))

    await expect(runDeferredProvisioning(RUN_ARGS)).resolves.toBeUndefined()

    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledTimes(1)
  })
})
