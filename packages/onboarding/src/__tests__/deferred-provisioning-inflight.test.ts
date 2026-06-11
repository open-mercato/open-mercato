const sendWorkspaceReadyEmail = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return {}
      throw new Error(`unavailable: ${name}`)
    },
  })),
}))

// No modules contribute seedExamples here — that path runs each hook inside a
// 15s timeout race whose timer would leak into jest. We assert dedup on the
// always-run sendWorkspaceReadyEmail step instead.
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  flattenSystemEntityIds: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    findById: jest.fn(async () => ({ preparationCompletedAt: new Date() })),
    markPreparationCompleted: jest.fn(async () => {}),
  })),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail,
}))

jest.mock('@open-mercato/core/modules/query_index/lib/reindexer', () => ({
  reindexEntity: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/purge', () => ({
  purgeIndexScope: jest.fn(async () => {}),
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

describe('runDeferredProvisioning in-flight guard', () => {
  beforeEach(() => {
    sendWorkspaceReadyEmail.mockReset()
    sendWorkspaceReadyEmail.mockResolvedValue(undefined)
  })

  it('runs the work once when two passes overlap for the same request', async () => {
    // The first pass suspends on its first await while holding the guard; a
    // second concurrent trigger for the same requestId must return immediately
    // instead of piling on another full reindex pass (the thundering herd that
    // exhausts the connection pool on the demo instance).
    const first = runDeferredProvisioning(args)
    const second = runDeferredProvisioning(args)

    await Promise.all([first, second])

    expect(sendWorkspaceReadyEmail).toHaveBeenCalledTimes(1)
  })

  it('runs again once the previous pass has settled (guard cleared in finally)', async () => {
    await runDeferredProvisioning(args)
    await runDeferredProvisioning(args)

    expect(sendWorkspaceReadyEmail).toHaveBeenCalledTimes(2)
  })

  it('clears the guard even when a pass throws, so a later poll can retry', async () => {
    sendWorkspaceReadyEmail.mockRejectedValueOnce(new Error('email boom'))

    await expect(runDeferredProvisioning(args)).rejects.toThrow('email boom')

    await runDeferredProvisioning(args)

    expect(sendWorkspaceReadyEmail).toHaveBeenCalledTimes(2)
  })

  it('runs concurrent passes for different requests independently', async () => {
    await Promise.all([
      runDeferredProvisioning(args),
      runDeferredProvisioning({ ...args, requestId: 'req-2' }),
    ])

    expect(sendWorkspaceReadyEmail).toHaveBeenCalledTimes(2)
  })
})
