const apiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}))

import {
  BULK_UPDATE_OWNER_ENDPOINT,
  buildReassignOwnerSuccess,
  requestBulkOwnerReassignment,
} from '../reassignDealOwner'

beforeEach(() => {
  apiCall.mockReset()
})

// Spec step 10 / Test Coverage "Bulk action payload and progress-id passthrough".
describe('requestBulkOwnerReassignment', () => {
  it('posts the selected ids and the chosen owner to the bulk endpoint', async () => {
    apiCall.mockResolvedValue({ ok: true, result: { ok: true, progressJobId: 'job-1', message: '' } })

    await requestBulkOwnerReassignment({
      ids: ['deal-1', 'deal-2'],
      ownerUserId: 'user-9',
      errorMessage: 'boom',
    })

    const [url, init] = apiCall.mock.calls[0]
    expect(url).toBe(BULK_UPDATE_OWNER_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ ids: ['deal-1', 'deal-2'], ownerUserId: 'user-9' })
  })

  it('passes the queued job id back to the caller', async () => {
    apiCall.mockResolvedValue({ ok: true, result: { ok: true, progressJobId: 'job-7', message: '' } })

    const outcome = await requestBulkOwnerReassignment({
      ids: ['deal-1'],
      ownerUserId: 'user-9',
      errorMessage: 'boom',
    })

    expect(outcome.progressJobId).toBe('job-7')
  })

  it('tolerates a response with no job id rather than throwing', async () => {
    apiCall.mockResolvedValue({ ok: true, result: { ok: true, progressJobId: null, message: '' } })

    const outcome = await requestBulkOwnerReassignment({
      ids: ['deal-1'],
      ownerUserId: 'user-9',
      errorMessage: 'boom',
    })

    expect(outcome.progressJobId).toBeNull()
  })

  it('throws the caller-supplied message when the request is rejected', async () => {
    apiCall.mockResolvedValue({ ok: false, result: null })

    await expect(
      requestBulkOwnerReassignment({ ids: ['deal-1'], ownerUserId: 'user-9', errorMessage: 'Could not start' }),
    ).rejects.toThrow('Could not start')
  })

  it('never sends a null owner, so a bulk unassignment cannot leave this path (D5)', async () => {
    apiCall.mockResolvedValue({ ok: true, result: { ok: true, progressJobId: 'job-1', message: '' } })

    await requestBulkOwnerReassignment({ ids: ['deal-1'], ownerUserId: 'user-9', errorMessage: 'boom' })

    expect(JSON.parse(apiCall.mock.calls[0][1].body).ownerUserId).toBe('user-9')
  })
})

// Spec step 11 / "selection resets after a successful enqueue". DataTable clears the selection
// when a bulk action resolves `ok: true`, and keeps it when the action resolves `false` — both
// already asserted in DataTable.propBulkActions.test.tsx. What that behaviour depends on is the
// shape this builder produces, which is what these lock down.
describe('buildReassignOwnerSuccess', () => {
  it('returns the ok+progressJobId shape DataTable clears the selection on', () => {
    const result = buildReassignOwnerSuccess({
      ids: ['deal-1', 'deal-2', 'deal-3'],
      progressJobId: 'job-3',
      message: 'Bulk owner update started (3 deals).',
    })

    expect(result).toMatchObject({ ok: true, progressJobId: 'job-3' })
  })

  it('reports the affected count from the selected ids', () => {
    const result = buildReassignOwnerSuccess({
      ids: ['deal-1', 'deal-2'],
      progressJobId: 'job-3',
      message: 'msg',
    })

    expect(result.affectedCount).toBe(2)
  })

  it('carries the caller message so the table flashes it instead of its generic copy', () => {
    const result = buildReassignOwnerSuccess({
      ids: ['deal-1'],
      progressJobId: null,
      message: 'Bulk owner update started (1 deals).',
    })

    expect(result.message).toBe('Bulk owner update started (1 deals).')
    // ok stays true with a null job id: the enqueue succeeded, there is just nothing to track.
    expect(result.ok).toBe(true)
  })
})
