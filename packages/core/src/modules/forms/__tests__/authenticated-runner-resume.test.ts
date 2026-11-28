import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createAuthRuntimeClient } from '../ui/public/state/runtime-client'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const request = jest.mocked(apiCall)
const formId = '42424242-4242-4242-8242-424242424242'
const subjectId = '41b3923a-468b-42d1-83b2-9f0dc6342f2f'
const subjectType = 'customer'
const submission = { id: 'draft-id', formVersionId: 'previous-published-version', subjectId, subjectType, status: 'draft' }

function answer(result: unknown) {
  request.mockResolvedValueOnce({ ok: true, status: 200, result, response: new Response(), cacheStatus: null })
}

describe('authenticated runtime resume', () => {
  const client = createAuthRuntimeClient({ formKey: 'customer-intake', subjectType, subjectId })

  beforeEach(() => request.mockReset())

  it('requests candidates using the loaded form identity and the runner subject', async () => {
    answer({ items: [submission, { ...submission, id: 'closed', status: 'submitted' }] })

    await expect(client.loadResumeCandidates(formId)).resolves.toEqual([submission])
    expect(request).toHaveBeenCalledWith(`/api/forms/form-submissions/by-subject/customer/${subjectId}?resume_form_id=${formId}`)
  })

  it('resolves the active form for callers that omit the optional form id', async () => {
    answer({ form: { id: formId } })
    answer({ items: [submission] })

    await expect(client.loadResumeCandidates()).resolves.toEqual([submission])
    expect(request).toHaveBeenNthCalledWith(1, '/api/forms/by-key/customer-intake/active')
    expect(request).toHaveBeenNthCalledWith(2, `/api/forms/form-submissions/by-subject/customer/${subjectId}?resume_form_id=${formId}`)
  })

  it('accepts explicit continuation of a same-form draft pinned to an earlier version', async () => {
    answer({ formId, submission, revision: { revisionNumber: 1 }, decoded_data: {}, actors: [] })

    await expect(client.loadSubmissionDetail(submission.id, formId)).resolves.toMatchObject({ submission })
  })

  it.each([
    { formId: 'a-different-form' },
    { submission: { ...submission, subjectType: 'other-subject-type' } },
    { submission: { ...submission, subjectId: 'a-different-subject' } },
    { submission: { ...submission, status: 'submitted' } },
  ])('declines mismatched or completed resume detail (%j)', async (override) => {
    answer({ formId, submission, ...override })

    await expect(client.loadSubmissionDetail(submission.id, formId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
