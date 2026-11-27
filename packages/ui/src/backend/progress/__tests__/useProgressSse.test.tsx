/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useProgressSse } from '../useProgressSse'
import type { ProgressJobDto } from '../useProgressPoll'

const mockApiCall = jest.fn()
const mockHandlers = new Map<string, (event: { payload: unknown }) => void>()

jest.mock('../../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('../../injection/useAppEvent', () => ({
  BRIDGE_RECONNECTED_EVENT_ID: 'bridge.reconnected',
  useAppEvent: (eventId: string, handler: (event: { payload: unknown }) => void) => {
    mockHandlers.set(eventId, handler)
  },
}))

it('keeps authenticated cancellation capabilities across SSE updates', async () => {
  const allowedJob: ProgressJobDto = {
    id: 'allowed',
    jobType: 'test.export',
    name: 'Export',
    status: 'running',
    progressPercent: 0,
    processedCount: 0,
    cancellable: true,
    canCancel: true,
  }
  const deniedJob = { ...allowedJob, id: 'denied', canCancel: false }
  mockApiCall.mockResolvedValue({ ok: true, result: { active: [allowedJob, deniedJob], recentlyCompleted: [] } })

  const { result } = renderHook(() => useProgressSse())
  await waitFor(() => expect(result.current.activeJobs).toEqual([allowedJob, deniedJob]))

  act(() => {
    const update = mockHandlers.get('progress.job.updated')
    if (!update) throw new Error('[internal] Missing progress update handler')
    update({ payload: { jobId: 'allowed', processedCount: 1 } })
    update({ payload: { jobId: 'denied', processedCount: 2, canCancel: true } })
    update({ payload: { jobId: 'new', processedCount: 3, cancellable: true, canCancel: true } })
  })

  expect(result.current.activeJobs).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'allowed', processedCount: 1, cancellable: true, canCancel: true }),
    expect.objectContaining({ id: 'denied', processedCount: 2, canCancel: false }),
  ]))
  expect(result.current.activeJobs.find((job) => job.id === 'new')?.canCancel).toBeUndefined()
})
