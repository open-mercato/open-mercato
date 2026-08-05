/** @jest-environment node */

import { GET as listChannels } from '../api/get/channels/route'
import { GET as getChannel } from '../api/get/channels/[id]/route'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const HOME_ORG_ID = '223e4567-e89b-12d3-a456-426614174001'
const OTHER_ORG_ID = '223e4567-e89b-12d3-a456-426614174002'
const CHANNEL_ID = '323e4567-e89b-12d3-a456-426614174001'

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

const channelStore: ChannelRecord[] = [homeOrgChannel]

function matchesOrganizationFilter(record: ChannelRecord, expected: unknown): boolean {
  if (expected === undefined) return true
  if (expected !== null && typeof expected === 'object' && '$in' in (expected as object)) {
    const ids = (expected as { $in: unknown }).$in
    return Array.isArray(ids) && ids.includes(record.organizationId)
  }
  return record.organizationId === expected
}

function selectChannels(where: Record<string, unknown>): ChannelRecord[] {
  return channelStore.filter((record) => {
    if (where.tenantId !== undefined && record.tenantId !== where.tenantId) return false
    if (where.userId !== undefined && record.userId !== where.userId) return false
    if (where.deletedAt !== undefined && record.deletedAt !== where.deletedAt) return false
    if (where.id !== undefined && record.id !== where.id) return false
    return matchesOrganizationFilter(record, where.organizationId)
  })
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
    expect(listWhereCalls[0].organizationId).toEqual({ $in: [OTHER_ORG_ID] })
    expect(listWhereCalls[0].userId).toBeNull()
  })

  test('keeps the tenant and shared-channel filters intact while scoping by selection', async () => {
    await listChannels(makeRequest('/api/communication_channels/channels', HOME_ORG_ID))

    expect(listWhereCalls[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: { $in: [HOME_ORG_ID] },
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
    expect(detailWhereCalls[0].organizationId).toEqual({ $in: [HOME_ORG_ID] })
  })

  test('detail reads 404 for a channel outside the selected organization', async () => {
    const response = await getChannel(
      makeRequest(`/api/communication_channels/channels/${CHANNEL_ID}`, OTHER_ORG_ID),
      { params: { id: CHANNEL_ID } },
    )

    expect(response.status).toBe(404)
    expect(detailWhereCalls[0].organizationId).toEqual({ $in: [OTHER_ORG_ID] })
  })
})
