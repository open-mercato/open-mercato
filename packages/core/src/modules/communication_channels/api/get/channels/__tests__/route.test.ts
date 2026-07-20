/** @jest-environment node */

// Regression: tenant-scoped push channels (FCM/APNs/Expo) are stored with
// `organization_id IS NULL` (see connect-credential-channel.ts). The channel
// list route used to filter `organizationId: auth.orgId ?? null`, so a channel
// connected while an admin had a NON-NULL selected org was invisible to the
// listing. The route now composes its `where` with `channelOrgScopeWhere`, so a
// tenant-wide (null) channel is returned from ANY org in the tenant while
// org-scoped channels stay scoped to their org.
//
// There is no live DB in this suite, so we assert the composed `where` passed to
// findAndCountWithDecryption (the query the route builds) rather than executing
// it. The connect-then-list assertions run the real matcher over fixture rows to
// prove which channels the composed filter would select.

const tenantId = '11111111-1111-4111-8111-111111111111'
const selectedOrgId = '22222222-2222-4222-8222-222222222222'
const otherOrgId = '33333333-3333-4333-8333-333333333333'

const findAndCountWithDecryptionMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

const em = { fork: () => em }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => findAndCountWithDecryptionMock(...args),
}))

import { GET } from '../route'

// The tenant-wide push channel connect-credential-channel produces for a push
// provider: organization_id = NULL, user_id = NULL.
const tenantWidePushChannel = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  providerKey: 'fcm',
  channelType: 'push',
  displayName: 'FCM',
  organizationId: null,
  userId: null,
  deletedAt: null,
  tenantId,
}
// An org-scoped channel belonging to a DIFFERENT org — must never leak.
const otherOrgChannel = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  providerKey: 'imap',
  channelType: 'email',
  displayName: 'Other org inbox',
  organizationId: otherOrgId,
  userId: null,
  deletedAt: null,
  tenantId,
}
// An org-scoped channel belonging to the caller's selected org.
const selectedOrgChannel = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  providerKey: 'imap',
  channelType: 'email',
  displayName: 'My org inbox',
  organizationId: selectedOrgId,
  userId: null,
  deletedAt: null,
  tenantId,
}

function invoke(url = 'http://localhost/api/communication_channels/channels') {
  return GET(new Request(url))
}

// Evaluate a MikroORM-style `where` fragment against a plain row, supporting the
// `$or` operator the fix relies on. Mirrors how the DB would apply the filter so
// the connect-then-list assertions test selection, not just filter shape.
function rowMatchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or') {
      const clauses = expected as Array<Record<string, unknown>>
      return clauses.some((clause) => rowMatchesWhere(row, clause))
    }
    return row[key] === expected
  })
}

describe('communication_channels channel list route — org scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ tenantId, orgId: selectedOrgId })
    findAndCountWithDecryptionMock.mockResolvedValue([[], 0])
  })

  function capturedWhere(): Record<string, unknown> {
    expect(findAndCountWithDecryptionMock).toHaveBeenCalledTimes(1)
    return findAndCountWithDecryptionMock.mock.calls[0][2] as Record<string, unknown>
  }

  it('composes the where with the org $or (selected org OR tenant-wide null) for a non-null org', async () => {
    const response = await invoke()
    expect(response.status).toBe(200)

    const where = capturedWhere()
    expect(where.tenantId).toBe(tenantId)
    expect(where.deletedAt).toBeNull()
    expect(where.userId).toBeNull()
    // The org scope is the $or form, NOT a bare `organizationId` equality — the
    // bug was the bare `organizationId: orgId ?? null` filter.
    expect(where.$or).toEqual([{ organizationId: selectedOrgId }, { organizationId: null }])
    expect(where).not.toHaveProperty('organizationId')
  })

  it('returns the tenant-wide (null-org) push channel even under a non-null selected org', async () => {
    const where = { ...(await captureWhereFor({ tenantId, orgId: selectedOrgId })) }
    expect(rowMatchesWhere(tenantWidePushChannel, where)).toBe(true)
  })

  it('does not leak an org-scoped channel from a DIFFERENT org', async () => {
    const where = { ...(await captureWhereFor({ tenantId, orgId: selectedOrgId })) }
    expect(rowMatchesWhere(otherOrgChannel, where)).toBe(false)
    // ...while the caller's own org-scoped channel still matches.
    expect(rowMatchesWhere(selectedOrgChannel, where)).toBe(true)
  })

  it('narrows to tenant-wide (null) rows only when the caller has no selected org', async () => {
    getAuthFromRequestMock.mockResolvedValue({ tenantId, orgId: null })
    const response = await invoke()
    expect(response.status).toBe(200)

    const where = capturedWhere()
    expect(where).not.toHaveProperty('$or')
    expect(where.organizationId).toBeNull()
    // The tenant-wide push channel is still visible; the selected-org channel is not.
    expect(rowMatchesWhere(tenantWidePushChannel, where)).toBe(true)
    expect(rowMatchesWhere(selectedOrgChannel, where)).toBe(false)
  })

  it('returns 401 when the request has no tenant', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)
    const response = await invoke()
    expect(response.status).toBe(401)
    expect(findAndCountWithDecryptionMock).not.toHaveBeenCalled()
  })

  async function captureWhereFor(auth: { tenantId: string; orgId: string | null }) {
    getAuthFromRequestMock.mockResolvedValue(auth)
    const response = await invoke()
    expect(response.status).toBe(200)
    return capturedWhere()
  }
})
