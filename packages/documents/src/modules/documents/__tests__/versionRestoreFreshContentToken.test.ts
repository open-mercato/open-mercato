const apiCallOrThrowMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (...args: unknown[]) => withScopedApiRequestHeadersMock(...args),
}))

import { restoreVersionWithObservedContentToken } from '../backend/documents/[id]/restoreVersion'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'
const OBSERVED_CONTENT_UPDATED_AT = '2026-07-10T14:15:16.123Z'
const ERROR_MESSAGE = 'Failed to restore version'

describe('restoreVersionWithObservedContentToken', () => {
  beforeEach(() => {
    apiCallOrThrowMock.mockReset()
    withScopedApiRequestHeadersMock.mockReset().mockImplementation(
      async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
    )
  })

  it('sends the previously observed content token without a pre-restore GET', async () => {
    const callOrder: string[] = []
    apiCallOrThrowMock.mockImplementation(async (url: string, init?: RequestInit) => {
      callOrder.push(`${init?.method ?? 'GET'} ${url}`)
      return { ok: true, result: { updatedAt: '2026-07-10T14:15:17.123Z' } }
    })

    await restoreVersionWithObservedContentToken({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      contentUpdatedAt: OBSERVED_CONTENT_UPDATED_AT,
      errorMessage: ERROR_MESSAGE,
    })

    expect(callOrder).toEqual([
      `POST /api/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/restore`,
    ])
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledWith(
      { 'x-om-ext-optimistic-lock-expected-updated-at': OBSERVED_CONTENT_UPDATED_AT },
      expect.any(Function),
    )
  })

  it('propagates 409 when a collaborator edits after the client observed its token', async () => {
    const conflict = Object.assign(new Error('Record changed'), {
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: '2026-07-10T14:15:18.123Z',
        expectedUpdatedAt: OBSERVED_CONTENT_UPDATED_AT,
      },
    })
    apiCallOrThrowMock.mockRejectedValueOnce(conflict)

    await expect(restoreVersionWithObservedContentToken({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      contentUpdatedAt: OBSERVED_CONTENT_UPDATED_AT,
      errorMessage: ERROR_MESSAGE,
    })).rejects.toBe(conflict)

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      `/api/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/restore`,
      { method: 'POST' },
      { errorMessage: ERROR_MESSAGE },
    )
  })

  it('fails closed when the client has no usable observed token', async () => {
    await expect(restoreVersionWithObservedContentToken({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      contentUpdatedAt: null,
      errorMessage: ERROR_MESSAGE,
    })).rejects.toThrow(ERROR_MESSAGE)

    expect(withScopedApiRequestHeadersMock).not.toHaveBeenCalled()
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })
})
