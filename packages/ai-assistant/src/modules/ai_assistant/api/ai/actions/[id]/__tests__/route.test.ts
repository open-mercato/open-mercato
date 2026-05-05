const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const repoGetByIdMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../../data/repositories/AiPendingActionRepository', () => ({
  AiPendingActionRepository: jest.fn().mockImplementation(() => ({
    getById: repoGetByIdMock,
  })),
}))

import { GET } from '../route'

function buildRequest(): Request {
  return new Request('http://localhost/api/ai_assistant/ai/actions/pa_123', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  })
}

function buildContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa_123',
    agentId: 'catalog.merchandising_assistant',
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
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T10:15:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    // server-internal fields — MUST NOT leak through the serializer
    normalizedInput: { secret: 'do-not-leak' },
    createdByUserId: 'user-1',
    idempotencyKey: 'idem_abc',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    ...overrides,
  }
}

describe('GET /api/ai/actions/:id route (Step 5.7)', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    loadAclMock.mockResolvedValue({
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: loadAclMock,
            hasAllFeatures: (required: string[], granted: string[]) =>
              required.every((feature) => granted.includes(feature)),
          }
        }
        if (name === 'em') {
          return {}
        }
        return null
      },
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)

    const response = await GET(buildRequest() as any, buildContext('pa_123'))

    expect(response.status).toBe(401)
    // 401 envelope does include `code: 'unauthenticated'` in this module's
    // routes (see chat/route.ts + prompt-override/route.ts). TC-AI-002
    // only requires "status 401 — body shape not asserted", and this route
    // follows the same shape. We still assert status only here to keep
    // contract parity with TC-AI-002 and avoid pinning downstream envelope
    // changes into this test.
  })

  it('happy path: tenant-matching id returns 200 + serialized row', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await GET(buildRequest() as any, buildContext('pa_123'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.id).toBe('pa_123')
    expect(body.agentId).toBe('catalog.merchandising_assistant')
    expect(body.status).toBe('pending')
    expect(body.toolName).toBe('catalog.update_product')
    expect(body.fieldDiff).toEqual([{ field: 'title', before: 'Old', after: 'New' }])
    expect(body.createdAt).toBe('2026-04-18T10:00:00.000Z')
    expect(body.expiresAt).toBe('2026-04-18T10:15:00.000Z')
    expect(body.resolvedAt).toBeNull()
    expect(body.resolvedByUserId).toBeNull()
    expect(body.queueMode).toBe('inline')

    // Repository was called with the tenant/org scope from the auth context.
    expect(repoGetByIdMock).toHaveBeenCalledTimes(1)
    expect(repoGetByIdMock).toHaveBeenCalledWith('pa_123', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
    })
  })

  it('cross-tenant id returns 404 pending_action_not_found', async () => {
    // Repository is tenant-scoped: getById returns null when the row belongs
    // to a different tenant/org.
    repoGetByIdMock.mockResolvedValueOnce(null)

    const response = await GET(buildRequest() as any, buildContext('pa_from_other_tenant'))

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('pending_action_not_found')
  })

  it('returns 404 when the id is unknown (no row)', async () => {
    repoGetByIdMock.mockResolvedValueOnce(null)

    const response = await GET(buildRequest() as any, buildContext('pa_missing'))

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('pending_action_not_found')
  })

  it('returns 403 when the caller lacks ai_assistant.view', async () => {
    loadAclMock.mockResolvedValueOnce({
      features: ['catalog.view'],
      isSuperAdmin: false,
    })

    const response = await GET(buildRequest() as any, buildContext('pa_123'))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('forbidden')
    expect(repoGetByIdMock).not.toHaveBeenCalled()
  })

  it('internal fields are never present in the response body', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await GET(buildRequest() as any, buildContext('pa_123'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toHaveProperty('normalizedInput')
    expect(body).not.toHaveProperty('createdByUserId')
    expect(body).not.toHaveProperty('idempotencyKey')
    expect(body).not.toHaveProperty('tenantId')
    expect(body).not.toHaveProperty('organizationId')
  })

  it('returns 400 when the id param is empty', async () => {
    const response = await GET(buildRequest() as any, buildContext(''))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('validation_error')
  })

  it('returns 404 when the caller has no tenant scope', async () => {
    authMock.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: null,
      orgId: null,
    })

    const response = await GET(buildRequest() as any, buildContext('pa_123'))

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('pending_action_not_found')
    expect(repoGetByIdMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the repository throws', async () => {
    repoGetByIdMock.mockRejectedValueOnce(new Error('db down'))

    const response = await GET(buildRequest() as any, buildContext('pa_123'))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe('internal_error')
  })
})
