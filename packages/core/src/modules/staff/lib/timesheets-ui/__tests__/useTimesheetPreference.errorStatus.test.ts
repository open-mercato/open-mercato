/** @jest-environment node */

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

import { QueryClient } from '@tanstack/react-query'
import { saveTimesheetPreference, timesheetPreferenceQueryOptions } from '../useTimesheetPreference'

const MEMBER_ID = '11111111-1111-1111-1111-111111111111'
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function readStatus(err: unknown): unknown {
  return (err as { status?: unknown })?.status
}

/**
 * The shared query client retries a failed query twice unless the error carries a
 * 400-404 `status` (`shouldRetryQuery` in `@open-mercato/ui/theme/QueryProvider`).
 * A bare `Error` hides the status, so a deterministic rejection — 403 when the
 * caller has no staff member in this organization — would be retried with backoff
 * while both seed effects sit blocked on `isLoading`, delaying the very seed this
 * feature exists to deliver.
 */
describe('timesheet preference request errors', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('carries the response status on a failed read so retries can be skipped', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 403, result: null })

    const { queryFn } = timesheetPreferenceQueryOptions(MEMBER_ID)

    await expect(queryFn()).rejects.toThrow('[internal] Failed to load timesheet preference.')
    await expect(queryFn().catch(readStatus)).resolves.toBe(403)
  })

  it('carries the response status on a failed write so the warning log is diagnosable', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: null })

    const queryClient = new QueryClient()
    const failure = await saveTimesheetPreference(queryClient, MEMBER_ID, PROJECT_ID).catch(
      (err: unknown) => err,
    )

    expect(readStatus(failure)).toBe(500)
  })

  it('does not invalidate the cached preference when the write failed', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 400, result: null })

    const queryClient = new QueryClient()
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries')

    await expect(saveTimesheetPreference(queryClient, MEMBER_ID, PROJECT_ID)).rejects.toBeDefined()

    expect(invalidateQueries).not.toHaveBeenCalled()
  })
})
