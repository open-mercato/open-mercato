const fork = jest.fn()
const resolve = jest.fn()
const findById = jest.fn()
const runDeferredProvisioning = jest.fn()

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    findById,
  })),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning', () => ({
  runDeferredProvisioning: (...args: unknown[]) => runDeferredProvisioning(...args),
}))

import handle, { metadata } from '../modules/onboarding/workers/prepare-workspace'
import {
  ONBOARDING_PREPARATION_QUEUE,
  ONBOARDING_PREPARATION_WORKER_ID,
  type OnboardingPreparationJobPayload,
} from '../modules/onboarding/lib/preparation-queue'
import type { JobContext, QueuedJob } from '@open-mercato/queue'

function makeJob(
  payload: Partial<OnboardingPreparationJobPayload> = {},
): QueuedJob<OnboardingPreparationJobPayload> {
  return {
    id: 'job-1',
    payload: {
      requestId: 'req-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      ...payload,
    },
    createdAt: new Date().toISOString(),
  }
}

function makeCtx(): JobContext & { resolve: <T = unknown>(name: string) => T } {
  const em = { fork }
  fork.mockReturnValue(em)
  resolve.mockImplementation((name: string) => {
    if (name === 'em') return em
    throw new Error(`unexpected resolve(${name})`)
  })
  return {
    jobId: 'job-1',
    queueName: ONBOARDING_PREPARATION_QUEUE,
    attemptNumber: 1,
    resolve,
  }
}

describe('onboarding prepare-workspace worker', () => {
  beforeEach(() => {
    fork.mockReset()
    resolve.mockReset()
    findById.mockReset()
    runDeferredProvisioning.mockReset()
  })

  it('declares the onboarding preparation queue metadata', () => {
    expect(metadata).toEqual({
      queue: ONBOARDING_PREPARATION_QUEUE,
      id: ONBOARDING_PREPARATION_WORKER_ID,
      concurrency: 1,
    })
  })

  it('runs deferred provisioning for an unfinished request', async () => {
    findById.mockResolvedValue({ id: 'req-1', preparationCompletedAt: null })

    await handle(makeJob(), makeCtx())

    expect(runDeferredProvisioning).toHaveBeenCalledWith({
      requestId: 'req-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('skips jobs whose request already completed preparation', async () => {
    findById.mockResolvedValue({ id: 'req-1', preparationCompletedAt: new Date() })

    await handle(makeJob(), makeCtx())

    expect(runDeferredProvisioning).not.toHaveBeenCalled()
  })

  it('skips jobs when the onboarding request no longer exists', async () => {
    findById.mockResolvedValue(null)

    await handle(makeJob(), makeCtx())

    expect(runDeferredProvisioning).not.toHaveBeenCalled()
  })
})
