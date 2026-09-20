const readApiResultOrThrowMock = jest.fn()
const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import {
  fetchAssignableStaffMembers,
  fetchAssignableStaffMembersPage,
} from '../assignableStaff'

function httpError(status: number): Error & { status: number } {
  const error = new Error(`Request failed (${status})`) as Error & { status: number }
  error.status = status
  return error
}

function abortError(): Error {
  const error = new Error('The operation was aborted.') as Error & { name: string }
  error.name = 'AbortError'
  return error
}

describe('fetchAssignableStaffMembersPage', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    apiCallMock.mockReset()
  })

  it('maps and dedupes assignable staff on success', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [
        { userId: 'user-1', displayName: 'Ada Lovelace', user: { email: 'ada@example.com' }, team: { name: 'Sales' } },
        { userId: 'user-1', displayName: 'Ada (dup)' },
        { userId: 'user-2', displayName: 'Grace Hopper' },
      ],
      total: 2,
      page: 1,
      pageSize: 24,
    })

    const result = await fetchAssignableStaffMembersPage('', { pageSize: 24 })

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      userId: 'user-1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      teamName: 'Sales',
    })
    expect(result.total).toBe(2)
    // `servedCount` is the row count the server sent, before the dedupe above.
    // Load-more guards read it rather than `items.length`, which is short here
    // and would read as a short page — ending the sequence a page early.
    expect(result.servedCount).toBe(3)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  // Regression for issue #6183: when the optional `staff` module is disabled the
  // assignable endpoint 404s. Owners are auth users (`ownerUserId`), so fall back
  // to `/api/auth/users` instead of an empty roster that renders "Unknown owner".
  it('falls back to auth users when the staff endpoint is missing (404)', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        items: [
          { id: 'user-admin', name: 'Admin User', email: 'admin@example.com' },
          { id: 'user-sales', email: 'sales@example.com' },
        ],
        total: 2,
      },
      response: {} as Response,
      cacheStatus: null,
    })

    const result = await fetchAssignableStaffMembersPage('', {
      page: 1,
      pageSize: 100,
      activeOrgId: 'org-1',
    })

    expect(apiCallMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/auth\/users\?/),
      expect.objectContaining({
        headers: { 'x-om-forbidden-redirect': '0' },
      }),
      expect.objectContaining({ fallback: null }),
    )
    const requestedUrl = String(apiCallMock.mock.calls[0]?.[0] ?? '')
    expect(requestedUrl).toContain('scopeToActiveOrganization=1')
    expect(requestedUrl).toContain('page=1')
    expect(requestedUrl).toContain('pageSize=100')

    expect(result.items).toEqual([
      {
        teamMemberId: null,
        userId: 'user-admin',
        displayName: 'Admin User',
        email: 'admin@example.com',
        teamName: null,
      },
      {
        teamMemberId: null,
        userId: 'user-sales',
        displayName: 'sales@example.com',
        email: 'sales@example.com',
        teamName: null,
      },
    ])
    expect(result.servedCount).toBe(2)
    expect(result.total).toBe(2)
  })

  it('does not set scopeToActiveOrganization when activeOrgId is absent', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: { items: [], total: 0 },
      response: {} as Response,
      cacheStatus: null,
    })

    // No activeOrgId passed — a tenant-level session should not scope to null org.
    await fetchAssignableStaffMembersPage('', { page: 1, pageSize: 24 })

    const requestedUrl = String(apiCallMock.mock.calls[0]?.[0] ?? '')
    expect(requestedUrl).not.toContain('scopeToActiveOrganization')
  })

  it('returns an empty page when staff is missing and auth users returns 403', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      result: null,
      response: {} as Response,
      cacheStatus: null,
    })

    const result = await fetchAssignableStaffMembersPage('', { page: 1, pageSize: 100 })

    expect(result).toEqual({ items: [], servedCount: 0, total: 0, page: 1, pageSize: 100 })
  })

  it('propagates 5xx from the auth users fallback — operator must not get silent empty pickers', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      result: null,
      response: {} as Response,
      cacheStatus: null,
    })

    await expect(fetchAssignableStaffMembersPage('', { page: 1, pageSize: 100 })).rejects.toMatchObject({
      status: 500,
    })
  })

  it('rethrows AbortError from the auth users fallback — cancellation is not an empty roster', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))
    apiCallMock.mockRejectedValueOnce(abortError())

    await expect(fetchAssignableStaffMembersPage('', { page: 1, pageSize: 100 })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('propagates non-404 failures from the staff endpoint (e.g. forbidden, server error)', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(403))
    await expect(fetchAssignableStaffMembersPage('', { pageSize: 100 })).rejects.toMatchObject({ status: 403 })

    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(500))
    await expect(fetchAssignableStaffMembersPage('', { pageSize: 100 })).rejects.toMatchObject({ status: 500 })

    readApiResultOrThrowMock.mockRejectedValueOnce(new Error('Network down'))
    await expect(fetchAssignableStaffMembersPage('', { pageSize: 100 })).rejects.toThrow('Network down')

    expect(apiCallMock).not.toHaveBeenCalled()
  })
})

describe('fetchAssignableStaffMembers', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    apiCallMock.mockReset()
  })

  it('returns auth users when the staff endpoint is missing (404)', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        items: [{ id: 'user-1', name: 'Pat', email: 'pat@example.com' }],
        total: 1,
      },
      response: {} as Response,
      cacheStatus: null,
    })

    const items = await fetchAssignableStaffMembers('', { pageSize: 100 })

    expect(items).toEqual([
      {
        teamMemberId: null,
        userId: 'user-1',
        displayName: 'Pat',
        email: 'pat@example.com',
        teamName: null,
      },
    ])
  })
})
