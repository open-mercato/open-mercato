/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/3184 —
// the channel health endpoint used to materialize every last-24h
// `message_channel_links` row into memory and count delivery statuses in JS.
// It now computes the counts with a grouped database aggregate, so the response
// stays a small fixed shape regardless of channel volume. These tests pin the
// aggregate response shape and confirm channel access + tenant scoping still
// hold.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const channelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const loadAclMock = jest.fn()
const assertCanAccessChannelMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

class ChannelAccessDeniedErrorMock extends Error {}

const kyselySelectFromMock = jest.fn()
const kyselyWhereMock = jest.fn()
const kyselyGroupByMock = jest.fn()
const kyselyExecuteMock = jest.fn()
const getKyselyMock = jest.fn()

const kyselyBuilder = {
  selectFrom: (...args: unknown[]) => {
    kyselySelectFromMock(...args)
    return kyselyBuilder
  },
  select: () => kyselyBuilder,
  where: (...args: unknown[]) => {
    kyselyWhereMock(...args)
    return kyselyBuilder
  },
  groupBy: (...args: unknown[]) => {
    kyselyGroupByMock(...args)
    return kyselyBuilder
  },
  execute: (...args: unknown[]) => kyselyExecuteMock(...args),
}

const em = {
  fork: () => em,
  getKysely: (...args: unknown[]) => getKyselyMock(...args),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return { loadAcl: loadAclMock }
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
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('../../../../../../lib/access-control', () => ({
  ChannelAccessDeniedError: ChannelAccessDeniedErrorMock,
  assertCanAccessChannel: (...args: unknown[]) => assertCanAccessChannelMock(...args),
  channelOrgScopeWhere: (orgId: string | null | undefined) =>
    orgId ? { $or: [{ organizationId: orgId }, { organizationId: null }] } : { organizationId: null },
}))

import { GET } from '../route'

const failedLink = {
  id: 'fail-1',
  messageId: 'msg-1',
  direction: 'outbound',
  createdAt: new Date('2026-06-20T00:00:00.000Z'),
  channelMetadata: { lastError: 'SMTP 550', transient: false },
}

function buildRequest() {
  return new Request(`http://localhost/api/communication_channels/channels/${channelId}/health`)
}

function invoke() {
  return GET(buildRequest(), { params: { id: channelId } })
}

describe('communication_channels channel health route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    loadAclMock.mockResolvedValue({ isSuperAdmin: true, features: ['*'], organizations: null })
    assertCanAccessChannelMock.mockImplementation(() => {})
    findOneWithDecryptionMock.mockResolvedValue({
      id: channelId,
      providerKey: 'imap',
      channelType: 'email',
    })
    // Conversations lookup returns one conversation; the bounded recent-failures
    // query returns a single failed link. The unbounded "load all links" query
    // that the old code issued for counts must never be made — return [] for any
    // unexpected link read so a regression surfaces as zeroed counts.
    findWithDecryptionMock.mockImplementation(async (_em, _entity, filter: Record<string, unknown>) => {
      if (filter && 'channelId' in filter) return [{ id: conversationId }]
      if (filter && filter.deliveryStatus === 'failed') return [failedLink]
      return []
    })
    getKyselyMock.mockReturnValue(kyselyBuilder)
    kyselyExecuteMock.mockResolvedValue([
      { delivery_status: 'sent', count: 3 },
      { delivery_status: 'failed', count: '2' },
      { delivery_status: 'pending', count: 1 },
      { delivery_status: 'bounced', count: 4 },
    ])
  })

  it('computes delivery-status counts with a grouped DB aggregate, not an in-memory scan', async () => {
    const response = await invoke()
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      channelId: string
      counts: Record<string, number>
      totalsLast24h: number
      recentFailures: Array<Record<string, unknown>>
    }

    // Counts come from the aggregate rows; an unknown status ('bounced') folds
    // into `other`, and totals are the sum across all groups.
    expect(body.channelId).toBe(channelId)
    expect(body.counts).toEqual({
      sent: 3,
      delivered: 0,
      read: 0,
      failed: 2,
      pending: 1,
      queued: 0,
      other: 4,
    })
    expect(body.totalsLast24h).toBe(10)

    // The aggregate runs in the database, grouped by delivery_status and scoped
    // to this channel's conversations, tenant, and 24h window.
    expect(getKyselyMock).toHaveBeenCalledTimes(1)
    expect(kyselySelectFromMock).toHaveBeenCalledWith('message_channel_links')
    expect(kyselyGroupByMock).toHaveBeenCalledWith('delivery_status')
    const whereColumns = kyselyWhereMock.mock.calls.map((call) => call[0])
    expect(whereColumns).toEqual(
      expect.arrayContaining(['external_conversation_id', 'tenant_id', 'created_at']),
    )

    // The unbounded "load every last-24h link" query is gone: the only
    // message_channel_links read is the bounded recent-failures query.
    const unboundedCountsLoad = findWithDecryptionMock.mock.calls.find((call) => {
      const filter = call[2] as Record<string, unknown> | undefined
      const options = call[3] as { limit?: number } | undefined
      return (
        !!filter &&
        'createdAt' in filter &&
        filter.deliveryStatus === undefined &&
        (!options || options.limit === undefined)
      )
    })
    expect(unboundedCountsLoad).toBeUndefined()

    // Recent failures stay bounded and carry last-error context.
    expect(body.recentFailures).toHaveLength(1)
    expect(body.recentFailures[0]).toMatchObject({ id: 'fail-1', lastError: 'SMTP 550' })
  })

  it('returns zeroed counts without querying when the channel has no conversations', async () => {
    findWithDecryptionMock.mockImplementation(async () => [])

    const response = await invoke()
    expect(response.status).toBe(200)

    const body = (await response.json()) as { counts: Record<string, number>; totalsLast24h: number }
    expect(body.totalsLast24h).toBe(0)
    expect(Object.values(body.counts).every((n) => n === 0)).toBe(true)
    // No conversations → no aggregate query at all.
    expect(getKyselyMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid channel id with 400', async () => {
    const response = await GET(
      new Request('http://localhost/api/communication_channels/channels/not-a-uuid/health'),
      { params: { id: 'not-a-uuid' } },
    )
    expect(response.status).toBe(400)
  })

  it('returns 401 when the request has no tenant', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)
    const response = await invoke()
    expect(response.status).toBe(401)
  })

  it('returns 404 when the channel is not found for the tenant', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const response = await invoke()
    expect(response.status).toBe(404)
    expect(getKyselyMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when channel access is denied', async () => {
    assertCanAccessChannelMock.mockImplementation(() => {
      throw new ChannelAccessDeniedErrorMock('denied')
    })
    const response = await invoke()
    expect(response.status).toBe(404)
    // Access is denied before any health aggregate runs.
    expect(getKyselyMock).not.toHaveBeenCalled()
  })
})
