const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
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

describe('fetchAssignableStaffMembersPage', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
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
  })

  // Regression for issue #2649: the assignable-staff endpoint is owned by the optional
  // `staff` module. When that module is disabled the route 404s, and entering the deals
  // (or people / companies) list must not break — it should degrade to an empty roster.
  it('returns an empty page when the staff endpoint is missing (404)', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))

    const result = await fetchAssignableStaffMembersPage('', { page: 1, pageSize: 100 })

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 100 })
  })

  it('propagates non-404 failures (e.g. forbidden, server error)', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(403))
    await expect(fetchAssignableStaffMembersPage('', { pageSize: 100 })).rejects.toMatchObject({ status: 403 })

    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(500))
    await expect(fetchAssignableStaffMembersPage('', { pageSize: 100 })).rejects.toMatchObject({ status: 500 })

    readApiResultOrThrowMock.mockRejectedValueOnce(new Error('Network down'))
    await expect(fetchAssignableStaffMembersPage('', { pageSize: 100 })).rejects.toThrow('Network down')
  })
})

describe('fetchAssignableStaffMembers', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('returns an empty list when the staff endpoint is missing (404)', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(httpError(404))

    const items = await fetchAssignableStaffMembers('', { pageSize: 100 })

    expect(items).toEqual([])
  })
})
