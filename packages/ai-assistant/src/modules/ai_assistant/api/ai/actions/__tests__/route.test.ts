const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const findAndCountMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findAndCountWithDecryption: (...args: unknown[]) => findAndCountMock(...args),
}))

import { GET, metadata, openApi } from '../route'

type StoredRow = Record<string, unknown> & { createdAt: Date }

type WhereClause = Record<string, unknown>

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$ne' in (expected as WhereClause)) {
    return actual !== (expected as WhereClause).$ne
  }
  return actual === expected
}

function rowMatches(row: StoredRow, where: WhereClause): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as WhereClause[]).some((branch) => rowMatches(row, branch))
    }
    return fieldMatches(row[key] ?? null, expected)
  })
}

let storedRows: StoredRow[] = []

function installStore(rows: StoredRow[]) {
  storedRows = rows
  findAndCountMock.mockImplementation(
    async (
      _em: unknown,
      _entity: unknown,
      where: WhereClause,
      options: { limit: number; offset: number },
    ) => {
      const matching = storedRows
        .filter((row) => rowMatches(row, where))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      return [matching.slice(options.offset, options.offset + options.limit), matching.length]
    },
  )
}

let rowCounter = 0

function makeRow(overrides: Record<string, unknown> = {}): StoredRow {
  rowCounter += 1
  return {
    id: `00000000-0000-4000-8000-${String(rowCounter).padStart(12, '0')}`,
    agentId: 'ai_assistant.raw_tool',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [{ field: 'title', before: 'Old', after: 'New' }],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    attachmentIds: [],
    targetEntityType: 'product',
    targetRecordId: 'prod_1',
    recordVersion: 'v1',
    queueMode: 'inline',
    executionResult: null,
    createdAt: new Date(Date.UTC(2026, 9, 22, 10, rowCounter)),
    expiresAt: new Date('2026-10-23T10:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    normalizedInput: { secret: 'do-not-leak' },
    createdByUserId: 'user-1',
    idempotencyKey: 'idem_abc',
    channel: 'mcp',
    apiKeyId: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    ...overrides,
  }
}

function buildRequest(query = ''): Request {
  return new Request(`http://localhost/api/ai_assistant/ai/actions${query}`, { method: 'GET' })
}

async function listIds(query = ''): Promise<string[]> {
  const response = await GET(buildRequest(query) as never)
  expect(response.status).toBe(200)
  const body = await response.json()
  return (body.items as Array<{ id: string }>).map((item) => item.id)
}

function grantFeatures(features: string[]) {
  loadAclMock.mockResolvedValue({ features, isSuperAdmin: false })
}

describe('GET /api/ai_assistant/ai/actions', () => {
  let ownChat: StoredRow
  let ownMcp: StoredRow
  let otherChat: StoredRow
  let otherMcp: StoredRow
  let otherToolsApi: StoredRow
  let foreignTenant: StoredRow
  let foreignOrg: StoredRow

  beforeEach(() => {
    jest.clearAllMocks()
    rowCounter = 0
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    grantFeatures(['ai_assistant.view'])
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        if (name === 'em') return {}
        return null
      },
    })
    ownChat = makeRow({ channel: 'agent', agentId: 'catalog.merchandising_assistant' })
    ownMcp = makeRow({ apiKeyId: 'key-1' })
    otherChat = makeRow({ channel: 'agent', createdByUserId: 'user-2' })
    otherMcp = makeRow({ createdByUserId: 'user-2', status: 'confirmed', toolName: 'customers.update_person' })
    otherToolsApi = makeRow({ createdByUserId: 'user-3', channel: 'tools-api' })
    foreignTenant = makeRow({ tenantId: 'tenant-2' })
    foreignOrg = makeRow({ organizationId: 'org-2', createdByUserId: 'user-2' })
    installStore([ownChat, ownMcp, otherChat, otherMcp, otherToolsApi, foreignTenant, foreignOrg])
  })

  it('declares auth + view feature metadata and an OpenAPI doc', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['ai_assistant.view'] })
    expect(openApi.methods?.GET).toBeDefined()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)
    const response = await GET(buildRequest() as never)
    expect(response.status).toBe(401)
  })

  it('returns 403 without ai_assistant.view', async () => {
    grantFeatures([])
    const response = await GET(buildRequest() as never)
    expect(response.status).toBe(403)
  })

  it('lists only own rows for a non-approver', async () => {
    const ids = await listIds()
    expect(ids.sort()).toEqual([ownChat.id, ownMcp.id].sort())
  })

  it('adds non-chat rows of others for approvers but never their chat rows', async () => {
    grantFeatures(['ai_assistant.view', 'ai_assistant.pending_actions.approve'])
    const ids = await listIds()
    expect(ids.sort()).toEqual([ownChat.id, ownMcp.id, otherMcp.id, otherToolsApi.id].sort())
    expect(ids).not.toContain(otherChat.id)
  })

  it('honours wildcard grants for the approver feature', async () => {
    grantFeatures(['ai_assistant.*'])
    const ids = await listIds()
    expect(ids).toContain(otherMcp.id)
    expect(ids).not.toContain(otherChat.id)
  })

  it('never lists rows from another tenant or organization', async () => {
    grantFeatures(['ai_assistant.view', 'ai_assistant.pending_actions.approve'])
    const ids = await listIds('?tenantId=tenant-2&organizationId=org-2')
    expect(ids).not.toContain(foreignTenant.id)
    expect(ids).not.toContain(foreignOrg.id)
    const [, , where] = findAndCountMock.mock.calls[0]
    expect(where).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('applies status, channel, toolName and mine filters', async () => {
    grantFeatures(['ai_assistant.view', 'ai_assistant.pending_actions.approve'])
    expect(await listIds('?status=confirmed')).toEqual([otherMcp.id])
    expect(await listIds('?channel=tools-api')).toEqual([otherToolsApi.id])
    expect(await listIds('?toolName=customers.update_person')).toEqual([otherMcp.id])
    expect((await listIds('?mine=true')).sort()).toEqual([ownChat.id, ownMcp.id].sort())
    expect((await listIds('?mine=0')).length).toBe(4)
  })

  it('rejects invalid filter values', async () => {
    for (const query of ['?status=bogus', '?channel=email', '?mine=maybe', '?page=0']) {
      const response = await GET(buildRequest(query) as never)
      expect(response.status).toBe(400)
    }
  })

  it('defaults to page 1 / pageSize 25 and caps pageSize at 100', async () => {
    const defaults = await (await GET(buildRequest() as never)).json()
    expect(defaults.page).toBe(1)
    expect(defaults.pageSize).toBe(25)

    const capped = await GET(buildRequest('?pageSize=100') as never)
    expect(capped.status).toBe(200)
    expect(findAndCountMock.mock.calls[1][3]).toMatchObject({ limit: 100, offset: 0 })

    const tooLarge = await GET(buildRequest('?pageSize=101') as never)
    expect(tooLarge.status).toBe(400)
  })

  it('paginates with total', async () => {
    grantFeatures(['ai_assistant.view', 'ai_assistant.pending_actions.approve'])
    const response = await GET(buildRequest('?page=2&pageSize=3') as never)
    const body = await response.json()
    expect(body.total).toBe(4)
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(3)
    expect(body.items).toHaveLength(1)
  })

  it('serializes items through the whitelist plus channel and requester', async () => {
    const response = await GET(buildRequest('?channel=mcp') as never)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    const [item] = body.items
    expect(item.id).toBe(ownMcp.id)
    expect(item.channel).toBe('mcp')
    expect(item.expiresAt).toBe('2026-10-23T10:00:00.000Z')
    expect(item.requester).toEqual({ userId: 'user-1', apiKeyId: 'key-1' })
    expect(item).not.toHaveProperty('normalizedInput')
    expect(item).not.toHaveProperty('createdByUserId')
    expect(item).not.toHaveProperty('idempotencyKey')
    expect(item).not.toHaveProperty('tenantId')
    expect(item).not.toHaveProperty('organizationId')
  })

  it('returns an empty page when the caller has no tenant', async () => {
    authMock.mockResolvedValueOnce({ sub: 'user-1', tenantId: null, orgId: null })
    const response = await GET(buildRequest() as never)
    const body = await response.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 25 })
    expect(findAndCountMock).not.toHaveBeenCalled()
  })
})
