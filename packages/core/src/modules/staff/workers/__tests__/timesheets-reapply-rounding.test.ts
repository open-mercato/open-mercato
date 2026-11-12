/** @jest-environment node */
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import type { ReapplyRoundingJobPayload } from '../../lib/time-tracking/reapplyRounding'

const failJob = jest.fn(async () => undefined)
let progressEnabled = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'progressService' && progressEnabled) return { failJob }
    throw new Error(`[internal] Could not resolve ${name}`)
  }),
}

const runTimeTrackingRecalculations = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('../../lib/time-tracking/recalculationRunner', () => ({
  runTimeTrackingRecalculations: (...args: unknown[]) => runTimeTrackingRecalculations(...args),
}))

import handle from '../timesheets-reapply-rounding'

const scope = { tenantId: 'tenant-1', organizationIds: ['org-1'], userId: 'user-1' }

function job(payload: ReapplyRoundingJobPayload): QueuedJob<ReapplyRoundingJobPayload> {
  return { id: 'queued-1', payload, createdAt: new Date().toISOString() }
}

describe('timesheets reapply-rounding worker', () => {
  beforeEach(() => {
    progressEnabled = true
    failJob.mockClear()
    runTimeTrackingRecalculations.mockReset()
  })

  it('marks the progress job failed and rethrows when a hook fails', async () => {
    runTimeTrackingRecalculations.mockRejectedValueOnce(new Error('[internal] hook failed'))

    await expect(handle(job({ progressJobId: 'job-1', scope }), {} as JobContext)).rejects.toThrow(
      '[internal] hook failed',
    )
    expect(failJob).toHaveBeenCalledWith(
      'job-1',
      { errorMessage: '[internal] hook failed' },
      { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
    )
  })

  it('rethrows the hook failure itself when the progress module is disabled', async () => {
    progressEnabled = false
    runTimeTrackingRecalculations.mockRejectedValueOnce(new Error('[internal] hook failed'))

    await expect(handle(job({ progressJobId: null, scope }), {} as JobContext)).rejects.toThrow(
      '[internal] hook failed',
    )
    expect(failJob).not.toHaveBeenCalled()
  })
})
