/** @jest-environment node */

import { GET as listChannels } from '../api/get/channels/route'
import { GET as getChannel } from '../api/get/channels/[id]/route'
import { GET as getChannelHealth } from '../api/get/channels/[id]/health/route'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const HOME_ORG_ID = '223e4567-e89b-12d3-a456-426614174001'
const OTHER_ORG_ID = '223e4567-e89b-12d3-a456-426614174002'
const CHANNEL_ID = '323e4567-e89b-12d3-a456-426614174001'
const OTHER_ORG_CHANNEL_ID = '323e4567-e89b-12d3-a456-426614174002'
const TENANT_WIDE_CHANNEL_ID = '323e4567-e89b-12d3-a456-426614174003'

type ChannelRecord = {
  id: string
  tenantId: string
  organizationId: string | null
  userId: string | null
  deletedAt: Date | null
  providerKey: string
  channelType: string
  displayName: string
  externalIdentifier: string | null
  isActive: boolean
  capabilities: Record<string, unknown> | null
  credentialsRef: string | null
  createdAt: Date
  updatedAt: Date
}

// The single shared channel from the bug report: it belongs to the admin's home
// organization, so switching to `OTHER_ORG_ID` must stop returning it.
const homeOrgChannel: ChannelRecord = {
  id: CHANNEL_ID,
  tenantId: TENANT_ID,
  organizationId: HOME_ORG_ID,
  userId: null,
  deletedAt: null,
  providerKey: 'resend',
  channelType: 'email',
  displayName: 'Resend system email',
  externalIdentifier: 'onboarding@resend.dev',
  isActive: true,
  capabilities: null,
  credentialsRef: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

// A second shared channel in the organization the admin can switch to. It only
// joins the store in the cases that assert cross-organization visibility, so the
// single-channel expectations above stay exact.
const otherOrgChannel: ChannelRecord = {
  ...homeOrgChannel,
  id: OTHER_ORG_CHANNEL_ID,
  organizationId: OTHER_ORG_ID,
  displayName: 'Resend marketing email',
  externalIdentifier: 'marketing@resend.dev',
}

// A tenant-scoped push provider channel: connected once for the whole tenant, stored with
// `organization_id IS NULL`, and therefore visible from every organization in it.
const tenantWideChannel: ChannelRecord = {
  ...homeOrgChannel,
  id: TENANT_WIDE_CHANNEL_ID,
  organizationId: null,
  channelType: 'push',
  providerKey: 'fcm',
  displayName: 'Firebase Cloud Messaging',
  externalIdentifier: 'demo-firebase-project',
}

const channelStore: ChannelRecord[] = []

function matchesOrganizationFilter(record: ChannelRecord, expected: unknown): boolean {
  if (expected === undefined) return true
  if (expected !== null && typeof expected === 'object' && '$in' in (expected as object)) {
    const ids = (expected as { $in: unknown }).$in
    return Array.isArray(ids) && ids.includes(record.organizationId)
  }
  return record.organizationId === expected
}

// The routes express org scoping as `$or: [{ organizationId: { $in } }, { organizationId: null }]`
// so tenant-wide channels (`organization_id IS NULL`, used by the tenant-scoped push providers) stay
// visible under any selection. The fake therefore has to evaluate that disjunction, not just a
// direct `organizationId` key.
function matchesOrganizationScope(record: ChannelRecord, where: Record<string, unknown>): boolean {
  const branches = where.$or
  if (Array.isArray(branches)) {
    return branches.some((branch) => {
      const clause = branch as Record<string, unknown>
      return 'organizationId' in clause && matchesOrganizationFilter(record, clause.organizationId)
    })
  }
  return matchesOrganizationFilter(record, where.organizationId)
}

function selectChannels(where: Record<string, unknown>): ChannelRecord[] {
  return channelStore.filter((record) => {
    if (where.tenantId !== undefined && record.tenantId !== where.tenantId) return false
    if (where.userId !== undefined && record.userId !== where.userId) return false
    if (where.deletedAt !== undefined && record.deletedAt !== where.deletedAt) return false
    if (where.id !== undefined && record.id !== where.id) return false
    return matchesOrganizationScope(record, where)
  })
}

// The selected organization plus the tenant-wide rows — the exact fragment
// `channelOrgScopeWhereFromFilter` emits for a caller restricted to `organizationIds`.
function orgScopeOf(organizationIds: string[]) {
  return [{ organizationId: { $in: organizationIds } }, { organizationId: null }]
}

const listWhereCalls: Record<string, unknown>[] = []
const detailWhereCalls: Record<string, unknown>[] = []

// Both organizations exist for the tenant and neither has children, so the
// selected-organization cookie resolves to a real, accessible org.
const organizationRows = [
  { id: HOME_ORG_ID, descendantIds: [] },
  { id: OTHER_ORG_ID, descendantIds: [] },
]

const mockEm = {
  fork: jest.fn(() => mockEm),
  find: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) => {
    const requested = (filter?.id as { $in?: unknown } | undefined)?.$in
    if (!Array.isArray(requested)) return organizationRows
    return organizationRows.filter((org) => requested.includes(org.id))
  }),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl }
    throw new Error(`[internal] unexpected DI token ${token}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: jest.fn(
    async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
      listWhereCalls.push(where)
      const rows = selectChannels(where)
      return [rows, rows.length]
    },
  ),
  findOneWithDecryption: jest.fn(
    async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
      detailWhereCalls.push(where)
      return selectChannels(where)[0] ?? null
    },
  ),
}))

function makeRequest(path: string, selectedOrganizationId?: string): Request {
  const headers: Record<string, string> = {}
  if (selectedOrganizationId) {
    headers.cookie = `om_selected_org=${encodeURIComponent(selectedOrganizationId)}`
  }
  return new Request(`http://localhost${path}`, { method: 'GET', headers })
}

describe('communication_channels channel reads follow the selected organization (#5012)', () => {
  beforeEach(() => {
    channelStore.length = 0
    channelStore.push(homeOrgChannel)
    listWhereCalls.length = 0
    detailWhereCalls.length = 0
    mockEm.find.mockClear()
    mockContainer.resolve.mockClear()
    mockGetAuthFromRequest.mockReset()
    mockLoadAcl.mockReset()
    // A plain tenant admin: `auth.orgId` stays pinned to the home organization
    // for the life of the session token, which is exactly why the routes must
    // not derive their organization filter from it.
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORG_ID,
      isSuperAdmin: false,
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['communication_channels.view', 'communication_channels.admin'],
      organizations: [HOME_ORG_ID, OTHER_ORG_ID],
    })
  })

  test('lists the home organization channel when no organization is selected', async () => {
    const response = await listChannels(makeRequest('/api/communication_channels/channels'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].displayName).toBe('Resend system email')
  })

  test('hides another organization channel once a different organization is selected', async () => {
    const response = await listChannels(
      makeRequest('/api/communication_channels/channels', OTHER_ORG_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(listWhereCalls).toHaveLength(1)
    expect(listWhereCalls[0].$or).toEqual(orgScopeOf([OTHER_ORG_ID]))
    expect(listWhereCalls[0].userId).toBeNull()
  })

  // The tenant-scoped push providers (FCM/APNs/Expo) connect with `organization_id IS NULL` on
  // purpose, so selection-based scoping must not hide them: a channel connected from one
  // organization has to stay visible and openable from every other one in the tenant.
  test('keeps a tenant-wide channel visible under any selection', async () => {
    channelStore.push(tenantWideChannel)

    const listResponse = await listChannels(
      makeRequest('/api/communication_channels/channels', OTHER_ORG_ID),
    )
    const listBody = await listResponse.json()

    expect(listResponse.status).toBe(200)
    expect(listBody.items.map((item: { id: string }) => item.id)).toEqual([TENANT_WIDE_CHANNEL_ID])

    const detailResponse = await getChannel(
      makeRequest(`/api/communication_channels/channels/${TENANT_WIDE_CHANNEL_ID}`, OTHER_ORG_ID),
      { params: { id: TENANT_WIDE_CHANNEL_ID } },
    )

    expect(detailResponse.status).toBe(200)
  })

  test('keeps the tenant and shared-channel filters intact while scoping by selection', async () => {
    await listChannels(makeRequest('/api/communication_channels/channels', HOME_ORG_ID))

    expect(listWhereCalls[0]).toMatchObject({
      tenantId: TENANT_ID,
      $or: orgScopeOf([HOME_ORG_ID]),
      deletedAt: null,
      userId: null,
    })
  })

  test('detail reads agree with the list: the channel opens under its own organization', async () => {
    const response = await getChannel(
      makeRequest(`/api/communication_channels/channels/${CHANNEL_ID}`, HOME_ORG_ID),
      { params: { id: CHANNEL_ID } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.id).toBe(CHANNEL_ID)
    expect(detailWhereCalls[0].$or).toEqual(orgScopeOf([HOME_ORG_ID]))
  })

  test('detail reads 404 for a channel outside the selected organization', async () => {
    const response = await getChannel(
      makeRequest(`/api/communication_channels/channels/${CHANNEL_ID}`, OTHER_ORG_ID),
      { params: { id: CHANNEL_ID } },
    )

    expect(response.status).toBe(404)
    expect(detailWhereCalls[0].$or).toEqual(orgScopeOf([OTHER_ORG_ID]))
  })

  test('health reads 404 for a channel outside the selected organization', async () => {
    const response = await getChannelHealth(
      makeRequest(`/api/communication_channels/channels/${CHANNEL_ID}/health`, OTHER_ORG_ID),
      { params: { id: CHANNEL_ID } },
    )

    expect(response.status).toBe(404)
    expect(detailWhereCalls[0].$or).toEqual(orgScopeOf([OTHER_ORG_ID]))
  })

  test('a super-admin with no selection sees every organization in the tenant', async () => {
    channelStore.push(otherOrgChannel)
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORG_ID,
      isSuperAdmin: true,
      roles: ['superadmin'],
    })
    mockLoadAcl.mockResolvedValue({ isSuperAdmin: true, features: ['*'], organizations: null })

    const response = await listChannels(makeRequest('/api/communication_channels/channels'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [CHANNEL_ID, OTHER_ORG_CHANNEL_ID].sort(),
    )
    expect(listWhereCalls[0]).not.toHaveProperty('organizationId')
    expect(listWhereCalls[0]).not.toHaveProperty('$or')
  })

  test('a selection the caller cannot access falls back to the accessible organizations', async () => {
    channelStore.push(otherOrgChannel)
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['communication_channels.view', 'communication_channels.admin'],
      organizations: [HOME_ORG_ID],
    })

    const response = await listChannels(
      makeRequest('/api/communication_channels/channels', OTHER_ORG_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listWhereCalls[0].$or).toEqual(orgScopeOf([HOME_ORG_ID]))
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(CHANNEL_ID)
  })
})
