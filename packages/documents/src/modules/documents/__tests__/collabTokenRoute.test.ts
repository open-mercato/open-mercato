import { Document } from '../data/entities'
import { verifyCollabTokenV2 } from '../lib/collabToken'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockResolveUserLabels = jest.fn()
const mockLoggerWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      error: jest.fn(),
      child: () => logger,
    }
    return logger
  },
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('../lib/platformServices', () => ({
  ...jest.requireActual('../lib/platformServices'),
  resolveOrganizationScopeService: () => ({
    resolve: jest.fn(), resolveFresh: jest.fn(),
    resolveForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => (
      key === 'documents.users.unknown' ? 'Generic collaborator' : fallback ?? key
    ),
  }),
}))

jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

type CollabTokenRoute = typeof import('../api/[id]/collab-token/route')

let GET: CollabTokenRoute['GET']
let features: string[]

const em = {
  find: jest.fn(async () => []),
  findOne: jest.fn(async (entity: unknown) => entity === Document ? {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ownerUserId: USER_ID,
    deletedAt: null,
  } : null),
}

const rbacService = {
  loadAcl: jest.fn(async () => ({
    isSuperAdmin: false,
    features,
    organizations: null,
  })),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    return undefined
  }),
}

beforeAll(async () => {
  const route = await import('../api/[id]/collab-token/route')
  GET = route.GET
})

beforeEach(() => {
  jest.clearAllMocks()
  features = ['documents.view']
  process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = 'collab-route-v2-secret-at-least-32-bytes'
  delete process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
    features: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  })
  mockResolveUserLabels.mockResolvedValue(new Map())
})

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/collab-token`)
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('collaboration token route capabilities', () => {
  it('keeps owner tier but signs read-only when documents.edit is absent', async () => {
    const response = await GET(request(), context())
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body).toMatchObject({
      documentId: DOCUMENT_ID,
      tier: 'owner',
      canEdit: false,
      readOnly: true,
      userName: 'Generic collaborator',
      user: {
        id: USER_ID,
        name: 'Generic collaborator',
      },
    })
    expect(JSON.stringify(body)).not.toContain(`"name":"${USER_ID}"`)
    const verified = verifyCollabTokenV2(String(body.token))
    expect(verified).toMatchObject({
      documentId: DOCUMENT_ID,
      tier: 'owner',
      readOnly: true,
      tokenVersion: 2,
    })
  })

  it('signs writable only when both tier and documents.edit allow it', async () => {
    features = ['documents.view', 'documents.edit']

    const response = await GET(request(), context())
    const body = await response.json() as Record<string, unknown>

    expect(body).toMatchObject({ canEdit: true, readOnly: false })
    expect(verifyCollabTokenV2(String(body.token))).toMatchObject({ readOnly: false })
  })

  it('degrades to the graceful non-collab response when the v2 secret is not ready', async () => {
    delete process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2
    mockLoggerWarn.mockClear()

    const response = await GET(request(), context())
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body).toMatchObject({
      token: '',
      url: null,
      documentId: DOCUMENT_ID,
      tier: 'owner',
      canEdit: false,
      readOnly: true,
      userName: 'Generic collaborator',
      user: {
        id: USER_ID,
        name: 'Generic collaborator',
      },
    })
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('DOCUMENTS_COLLAB_JWT_SECRET_V2'),
    )
  })

  it('rejects a too-short v2 secret the same graceful way', async () => {
    process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = 'fewer-than-thirty-two-bytes'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const response = await GET(request(), context())
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body).toMatchObject({ token: '', url: null })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('disables collaboration instead of failing when the endpoint is invalid', async () => {
    process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL = 'https://collab.example.test'

    const response = await GET(request(), context())
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ url: null })
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('NEXT_PUBLIC_DOCUMENTS_COLLAB_URL'),
    )
  })

  it('refuses API-key collaboration tokens until the sidecar can preserve the key subject', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'api_key:55555555-5555-4555-8555-555555555555',
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      roles: [],
      isApiKey: true,
    })

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
    expect(mockResolveUserLabels).not.toHaveBeenCalled()
  })

  it('recognizes an API-key subject even when a trusted context omits the optional flag', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'api_key:55555555-5555-4555-8555-555555555555',
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      roles: [],
    })

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
    expect(mockResolveUserLabels).not.toHaveBeenCalled()
  })
})
