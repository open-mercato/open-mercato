const order: string[] = []

const findById = jest.fn()
const claimPreparation = jest.fn()
const releasePreparation = jest.fn(async () => { order.push('release') })
const markPreparationCompleted = jest.fn(async () => { order.push('markCompleted') })
const sendWorkspaceReadyEmail = jest.fn(async () => { order.push('email') })
const reindexEntity = jest.fn(async () => { order.push('reindex') })
const purgeIndexScope = jest.fn(async () => { order.push('purge') })

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return {}
      throw new Error(`unavailable: ${name}`)
    },
  })),
}))

// No modules contribute seedExamples — that path runs each hook inside a 15s
// timeout race whose timer would leak into jest.
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: jest.fn(() => []),
}))

// One system entity so the rebuild loop actually calls purge/reindex, letting
// us assert the completion flag is written AFTER the rebuild.
jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  flattenSystemEntityIds: jest.fn(() => ['example:thing']),
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    findById,
    claimPreparation,
    releasePreparation,
    markPreparationCompleted,
  })),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail,
}))

jest.mock('@open-mercato/core/modules/query_index/lib/reindexer', () => ({
  reindexEntity,
}))

jest.mock('@open-mercato/core/modules/query_index/lib/purge', () => ({
  purgeIndexScope,
}))

jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: jest.fn(async () => {}),
}))

import { runDeferredProvisioning } from '@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning'

const args = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

describe('runDeferredProvisioning claim', () => {
  beforeEach(() => {
    order.length = 0
    findById.mockReset()
    findById.mockResolvedValue({ id: 'req-1', preparationCompletedAt: null })
    claimPreparation.mockReset()
    claimPreparation.mockResolvedValue(true)
    releasePreparation.mockClear()
    markPreparationCompleted.mockClear()
    sendWorkspaceReadyEmail.mockClear()
    reindexEntity.mockClear()
    purgeIndexScope.mockClear()
  })

  it('claims, runs the pass, and releases the claim', async () => {
    await runDeferredProvisioning(args)

    expect(claimPreparation).toHaveBeenCalledTimes(1)
    expect(reindexEntity).toHaveBeenCalledTimes(1)
    expect(markPreparationCompleted).toHaveBeenCalledTimes(1)
    expect(releasePreparation).toHaveBeenCalledTimes(1)
  })

  it('skips the pass when the claim is not acquired (a concurrent poll holds it)', async () => {
    claimPreparation.mockResolvedValue(false)

    await runDeferredProvisioning(args)

    expect(claimPreparation).toHaveBeenCalledTimes(1)
    expect(reindexEntity).not.toHaveBeenCalled()
    expect(markPreparationCompleted).not.toHaveBeenCalled()
    expect(releasePreparation).not.toHaveBeenCalled()
    expect(sendWorkspaceReadyEmail).not.toHaveBeenCalled()
  })

  it('returns before claiming when preparation is already completed', async () => {
    findById.mockResolvedValue({ id: 'req-1', preparationCompletedAt: new Date() })

    await runDeferredProvisioning(args)

    expect(claimPreparation).not.toHaveBeenCalled()
    expect(reindexEntity).not.toHaveBeenCalled()
  })

  it('writes the completion flag only after the query-index rebuild', async () => {
    await runDeferredProvisioning(args)

    expect(order.indexOf('reindex')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('reindex')).toBeLessThan(order.indexOf('markCompleted'))
    expect(order.indexOf('markCompleted')).toBeLessThan(order.indexOf('email'))
  })

  it('releases the claim even when the pass throws, so a later poll can retry', async () => {
    sendWorkspaceReadyEmail.mockRejectedValueOnce(new Error('email boom'))

    await expect(runDeferredProvisioning(args)).rejects.toThrow('email boom')

    expect(releasePreparation).toHaveBeenCalledTimes(1)
  })
})
