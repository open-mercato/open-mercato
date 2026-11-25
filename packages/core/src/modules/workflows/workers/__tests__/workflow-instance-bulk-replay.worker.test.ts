/** @jest-environment node */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { createContainer } from 'awilix'

const runBulkReplay = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const createRequestContainer = jest.fn<() => Promise<unknown>>()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => createRequestContainer(),
}))

jest.mock('../../lib/bulk-replay', () => ({
  WORKFLOW_INSTANCE_BULK_REPLAY_QUEUE: 'workflow-instance-bulk-replay',
  runBulkReplay: (...args: unknown[]) => runBulkReplay(...args),
}))

import handle from '../workflow-instance-bulk-replay'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

function makeJob(progressJobId: string | null) {
  return {
    id: 'queue-job-1',
    payload: { progressJobId, action: 'retry' as const, ids: ['a'], scope },
  }
}

describe('workflow-instance-bulk-replay worker', () => {
  beforeEach(() => {
    runBulkReplay.mockReset()
    createRequestContainer.mockReset()
  })

  test('fails the progress job and rethrows the original error when progress is enabled', async () => {
    const failJob = jest.fn(async () => undefined)
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'progressService' ? { failJob } : null),
    })
    const original = new Error('replay exploded')
    runBulkReplay.mockRejectedValue(original)

    await expect(handle(makeJob('job-1') as never, {} as never)).rejects.toBe(original)
    expect(failJob).toHaveBeenCalledWith('job-1', { errorMessage: 'replay exploded' }, scope)
  })

  test('rethrows the original error, not a DI resolution error, when progress is disabled (#9217)', async () => {
    createRequestContainer.mockResolvedValue(createContainer())
    const original = new Error('replay exploded')
    runBulkReplay.mockRejectedValue(original)

    await expect(handle(makeJob('job-1') as never, {} as never)).rejects.toBe(original)
  })

  test('passes a null progress job id through to the replay', async () => {
    createRequestContainer.mockResolvedValue({ resolve: () => null })
    runBulkReplay.mockResolvedValue({})

    await handle(makeJob(null) as never, {} as never)

    expect(runBulkReplay).toHaveBeenCalledWith(expect.objectContaining({ progressJobId: null }))
  })
})
