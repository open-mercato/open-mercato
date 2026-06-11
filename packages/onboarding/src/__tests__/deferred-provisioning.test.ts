const seedExamples = jest.fn(async () => {
  await new Promise((resolve) => setImmediate(resolve))
})
const purgeIndexScope = jest.fn(async () => {})
const reindexEntity = jest.fn(async () => {})
const refreshCoverageSnapshot = jest.fn(async () => {})
const sendWorkspaceReadyEmail = jest.fn(async () => true)

type ClaimState = {
  preparationStartedAt: Date | null
  preparationCompletedAt: Date | null
}

const claimState: ClaimState = {
  preparationStartedAt: null,
  preparationCompletedAt: null,
}

const claimPreparation = jest.fn(async (_requestId: string, claimedAt: Date, staleBefore: Date) => {
  if (claimState.preparationCompletedAt) return false
  if (claimState.preparationStartedAt && claimState.preparationStartedAt.getTime() >= staleBefore.getTime()) {
    return false
  }
  claimState.preparationStartedAt = claimedAt
  return true
})

const findById = jest.fn(async (id: string) => ({
  id,
  preparationCompletedAt: claimState.preparationCompletedAt,
}))

const markPreparationCompleted = jest.fn(async (_request: unknown, completedAt: Date) => {
  claimState.preparationCompletedAt = completedAt
})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return {}
      throw new Error(`unexpected resolve(${name})`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => [{ id: 'catalog', setup: { seedExamples } }],
}))

jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  flattenSystemEntityIds: () => ['catalog:product'],
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({}),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/reindexer', () => ({
  reindexEntity: (...args: unknown[]) => reindexEntity(...(args as [])),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/purge', () => ({
  purgeIndexScope: (...args: unknown[]) => purgeIndexScope(...(args as [])),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: (...args: unknown[]) => refreshCoverageSnapshot(...(args as [])),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail: (...args: unknown[]) => sendWorkspaceReadyEmail(...(args as [])),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    claimPreparation,
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

describe('runDeferredProvisioning single-flight claim', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    jest.clearAllMocks()
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
    // runDeferredProvisioning chain (seedExamples for every module + a forced
    // purge/reindex of every system entity) until preparationCompletedAt was
    // flushed. Dozens of concurrent chains exhausted the 20-connection PG pool,
    // the completion flag write itself timed out, and the loop never
    // terminated. Concurrent triggers must collapse into exactly one run.
    await Promise.all([
      runDeferredProvisioning(RUN_ARGS),
      runDeferredProvisioning(RUN_ARGS),
      runDeferredProvisioning(RUN_ARGS),
    ])

    expect(seedExamples).toHaveBeenCalledTimes(1)
    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
    expect(purgeIndexScope).toHaveBeenCalledTimes(1)
    expect(reindexEntity).toHaveBeenCalledTimes(1)
    expect(sendWorkspaceReadyEmail).toHaveBeenCalledTimes(1)
  })

  it('does not run any heavy work when preparation already completed', async () => {
    claimState.preparationCompletedAt = new Date()

    await runDeferredProvisioning(RUN_ARGS)

    expect(seedExamples).not.toHaveBeenCalled()
    expect(purgeIndexScope).not.toHaveBeenCalled()
    expect(reindexEntity).not.toHaveBeenCalled()
    expect(sendWorkspaceReadyEmail).not.toHaveBeenCalled()
  })

  it('re-claims and recovers when a previous claim went stale', async () => {
    claimState.preparationStartedAt = new Date(Date.now() - 20 * 60 * 1000)

    await runDeferredProvisioning(RUN_ARGS)

    expect(seedExamples).toHaveBeenCalledTimes(1)
    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
  })

  it('marks preparation completed only after the query-index rebuild (death mid-rebuild stays recoverable)', async () => {
    // preparationCompletedAt is the terminal gate for both the status-route
    // scheduling and claimPreparation. If it were written before the rebuild,
    // a runner dying mid-rebuild would leave the tenant permanently without
    // index rows — nothing would ever reclaim the run.
    await runDeferredProvisioning(RUN_ARGS)

    expect(reindexEntity).toHaveBeenCalled()
    expect(markPreparationCompleted).toHaveBeenCalled()
    expect(reindexEntity.mock.invocationCallOrder[0]).toBeLessThan(
      markPreparationCompleted.mock.invocationCallOrder[0],
    )
  })

  it('still rebuilds query indexes when the ready email fails', async () => {
    // #2954's contract: post-provisioning steps are non-fatal. A transient
    // SMTP failure must not abort the chain before the query-index rebuild,
    // otherwise the tenant is left permanently without index rows (the
    // completion flag is already set, so nothing ever retries the rebuild).
    sendWorkspaceReadyEmail.mockRejectedValue(new Error('smtp down'))

    await expect(runDeferredProvisioning(RUN_ARGS)).resolves.toBeUndefined()

    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
    expect(purgeIndexScope).toHaveBeenCalledTimes(1)
    expect(reindexEntity).toHaveBeenCalledTimes(1)
  })
})
