/** @jest-environment node */

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
  AttachmentDocumentExtraction: class AttachmentDocumentExtraction {},
  AttachmentDocumentSection: class AttachmentDocumentSection {},
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type AuthFixture = {
  sub: string
  tenantId: string | null
  orgId: string | null
  features?: string[]
  isSuperAdmin?: boolean
}

let currentAuth: AuthFixture | null = null

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => currentAuth),
}))

const mockGuardInstances: Array<{
  id: string
  targetEntity: string
  operations: Array<'create' | 'update' | 'delete'>
  validate: jest.Mock
  afterSuccess?: jest.Mock
}> = []

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: () => mockGuardInstances,
}))

const service = {
  getStructure: jest.fn(),
  listSections: jest.fn(),
  getSection: jest.fn(),
  resolveCitation: jest.fn(),
  requestExtraction: jest.fn(),
  getNormalizedText: jest.fn(),
  getStats: jest.fn(),
}
const commandBus = { execute: jest.fn() }
const fakeEm = { name: 'em' }

const mockResolveAttachmentRequestScope = jest.fn(
  async (_container: unknown, auth: AuthFixture | null) => ({ denied: false, organizationId: auth?.orgId ?? null }),
)
jest.mock('../../lib/requestScope', () => ({
  resolveAttachmentRequestScope: (...args: [unknown, AuthFixture | null]) => mockResolveAttachmentRequestScope(...args),
}))

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'attachmentDocumentStructureService') return service
      if (name === 'commandBus') return commandBus
      if (name === 'em') return fakeEm
      throw new Error(`[internal] unexpected resolve ${name}`)
    },
    hasRegistration: () => false,
  }),
}))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { GET as getStructure, POST as requestStructure, metadata as structureMetadata } from '../structure/[id]/route'
import { GET as getSections, metadata as sectionsMetadata } from '../structure/[id]/sections/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const SELECTED_ORG_ID = '66666666-6666-4666-8666-666666666666'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444'
const EXTRACTION_ID = '55555555-5555-4555-8555-555555555555'

function routeContext(id: string = ATTACHMENT_ID) {
  return { params: Promise.resolve({ id }) }
}

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost/api/attachments/structure/${ATTACHMENT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGuardInstances.length = 0
  currentAuth = { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, features: ['attachments.view', 'attachments.manage'] }
})

describe('document structure route metadata', () => {
  it('requires attachments.view to read and attachments.manage to request extraction', () => {
    expect(structureMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['attachments.view'] })
    expect(structureMetadata.POST).toEqual({ requireAuth: true, requireFeatures: ['attachments.manage'] })
    expect(sectionsMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['attachments.view'] })
  })
})

describe('GET /api/attachments/structure/:id', () => {
  it('returns 401 without an authenticated tenant', async () => {
    currentAuth = null
    const response = await getStructure(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}`), routeContext())
    expect(response.status).toBe(401)
    expect(service.getStructure).not.toHaveBeenCalled()
  })

  it('returns 400 when no organization is selected', async () => {
    currentAuth = { sub: USER_ID, tenantId: TENANT_ID, orgId: null }
    const response = await getStructure(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}`), routeContext())
    expect(response.status).toBe(400)
    expect(service.getStructure).not.toHaveBeenCalled()
  })

  it('returns 404 for a malformed attachment id without querying the service', async () => {
    const response = await getStructure(getRequest('/api/attachments/structure/not-a-uuid'), routeContext('not-a-uuid'))
    expect(response.status).toBe(404)
    expect(service.getStructure).not.toHaveBeenCalled()
  })

  it('returns 404 when the service denies access', async () => {
    service.getStructure.mockResolvedValue(null)
    const response = await getStructure(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}`), routeContext())
    expect(response.status).toBe(404)
  })

  it('passes the authenticated scope and parsed query to the service', async () => {
    service.getStructure.mockResolvedValue({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })
    const response = await getStructure(
      getRequest(`/api/attachments/structure/${ATTACHMENT_ID}?maxDepth=2&includeOutline=false`),
      routeContext(),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })
    expect(service.getStructure).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID, auth: currentAuth },
      maxDepth: 2,
      includeOutline: false,
    })
  })

  it('rejects an out-of-range maxDepth', async () => {
    const response = await getStructure(
      getRequest(`/api/attachments/structure/${ATTACHMENT_ID}?maxDepth=9`),
      routeContext(),
    )
    expect(response.status).toBe(400)
    expect(service.getStructure).not.toHaveBeenCalled()
  })
})

describe('GET /api/attachments/structure/:id/sections', () => {
  const sectionsPath = `/api/attachments/structure/${ATTACHMENT_ID}/sections`

  it('rejects a page size above 100', async () => {
    const response = await getSections(getRequest(`${sectionsPath}?limit=101`), routeContext())
    expect(response.status).toBe(400)
    expect(service.listSections).not.toHaveBeenCalled()
  })

  it('passes filters, keyset cursor and defaults to the service', async () => {
    service.listSections.mockResolvedValue({ extractionId: EXTRACTION_ID, items: [], nextCursor: null })
    const response = await getSections(
      getRequest(`${sectionsPath}?numberLabel=8.12&kinds=clause,section&afterOrdinal=12&limit=100&page=3`),
      routeContext(),
    )
    expect(response.status).toBe(200)
    expect(service.listSections).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID, auth: currentAuth },
      parentId: null,
      anchorKey: null,
      numberLabel: '8.12',
      page: 3,
      kinds: ['clause', 'section'],
      afterOrdinal: 12,
      limit: 100,
      includeText: true,
      includeDescendants: false,
      maxCharsPerSection: 4000,
    })
  })

  it('rejects unknown section kinds', async () => {
    const response = await getSections(getRequest(`${sectionsPath}?kinds=bogus`), routeContext())
    expect(response.status).toBe(400)
  })

  it('returns 404 when the attachment is not accessible', async () => {
    service.listSections.mockResolvedValue(null)
    service.getStructure.mockResolvedValue(null)
    const response = await getSections(getRequest(sectionsPath), routeContext())
    expect(response.status).toBe(404)
  })

  it('returns an empty page when the attachment has not been extracted', async () => {
    service.listSections.mockResolvedValue(null)
    service.getStructure.mockResolvedValue({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })
    const response = await getSections(getRequest(sectionsPath), routeContext())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ extractionId: null, items: [], nextCursor: null })
  })
})

describe('document structure route organization scope', () => {
  it('uses the organization selected in the switcher instead of the home organization', async () => {
    mockResolveAttachmentRequestScope.mockResolvedValueOnce({ denied: false, organizationId: SELECTED_ORG_ID })
    service.getStructure.mockResolvedValue({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })

    const response = await getStructure(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}`), routeContext())

    expect(response.status).toBe(200)
    expect(service.getStructure).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          tenantId: TENANT_ID,
          organizationId: SELECTED_ORG_ID,
          auth: expect.objectContaining({ sub: USER_ID, orgId: SELECTED_ORG_ID }),
        },
      }),
    )
  })

  it('requests extraction within the selected organization', async () => {
    mockResolveAttachmentRequestScope.mockResolvedValueOnce({ denied: false, organizationId: SELECTED_ORG_ID })
    commandBus.execute.mockResolvedValue({
      result: { attachmentId: ATTACHMENT_ID, extractionId: null, status: 'pending', enqueued: true },
      logEntry: null,
    })

    const response = await requestStructure(postRequest({}), routeContext())

    expect(response.status).toBe(202)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'attachments.document_structure.request',
      expect.objectContaining({
        input: expect.objectContaining({ organizationId: SELECTED_ORG_ID }),
        ctx: expect.objectContaining({ selectedOrganizationId: SELECTED_ORG_ID, organizationIds: [SELECTED_ORG_ID] }),
      }),
    )
  })

  it('answers 404 when the organization scope resolves to nothing accessible', async () => {
    mockResolveAttachmentRequestScope.mockResolvedValueOnce({ denied: true, organizationId: null })

    const response = await getSections(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}/sections`), routeContext())

    expect(response.status).toBe(404)
    expect(service.listSections).not.toHaveBeenCalled()
  })

  it('lets a superadmin browsing all organizations reach the attachment in its own organization', async () => {
    currentAuth = { sub: USER_ID, tenantId: TENANT_ID, orgId: null, isSuperAdmin: true }
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: ATTACHMENT_ID, organizationId: ORG_ID })
    service.getStructure.mockResolvedValue({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })

    const response = await getStructure(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}`), routeContext())

    expect(response.status).toBe(200)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      fakeEm,
      expect.anything(),
      { id: ATTACHMENT_ID, tenantId: TENANT_ID },
      { fields: ['id', 'organizationId'] },
      { tenantId: TENANT_ID, organizationId: null },
    )
    expect(service.getStructure).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }),
      }),
    )
  })

  it('answers 404 to a superadmin without a selected organization when the attachment is not in the tenant', async () => {
    currentAuth = { sub: USER_ID, tenantId: TENANT_ID, orgId: null, isSuperAdmin: true }
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await getStructure(getRequest(`/api/attachments/structure/${ATTACHMENT_ID}`), routeContext())

    expect(response.status).toBe(404)
    expect(service.getStructure).not.toHaveBeenCalled()
  })
})

describe('POST /api/attachments/structure/:id', () => {
  it('returns 202 when an extraction job is queued through the command', async () => {
    commandBus.execute.mockResolvedValue({
      result: { attachmentId: ATTACHMENT_ID, extractionId: null, status: 'pending', enqueued: true },
      logEntry: null,
    })
    const response = await requestStructure(postRequest({ force: true, ocr: 'never' }), routeContext())
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ attachmentId: ATTACHMENT_ID, extractionId: null, status: 'pending' })
    expect(commandBus.execute).toHaveBeenCalledWith(
      'attachments.document_structure.request',
      expect.objectContaining({
        input: {
          attachmentId: ATTACHMENT_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          force: true,
          ocr: 'never',
        },
        ctx: expect.objectContaining({ auth: currentAuth, selectedOrganizationId: ORG_ID, organizationIds: [ORG_ID] }),
      }),
    )
  })

  it('returns 200 with the current extraction when nothing was queued', async () => {
    commandBus.execute.mockResolvedValue({
      result: { attachmentId: ATTACHMENT_ID, extractionId: EXTRACTION_ID, status: 'completed', enqueued: false },
      logEntry: null,
    })
    const response = await requestStructure(postRequest(''), routeContext())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      attachmentId: ATTACHMENT_ID,
      extractionId: EXTRACTION_ID,
      status: 'completed',
    })
  })

  it('rejects malformed JSON and invalid options', async () => {
    expect((await requestStructure(postRequest('{oops'), routeContext())).status).toBe(400)
    expect((await requestStructure(postRequest({ ocr: 'sometimes' }), routeContext())).status).toBe(400)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('maps command HTTP errors such as 404, 413 and 422', async () => {
    commandBus.execute.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Attachment not found' }))
    expect((await requestStructure(postRequest({}), routeContext())).status).toBe(404)
    commandBus.execute.mockRejectedValueOnce(new CrudHttpError(413, { error: 'Too large', code: 'too_large' }))
    expect((await requestStructure(postRequest({}), routeContext())).status).toBe(413)
    commandBus.execute.mockRejectedValueOnce(new CrudHttpError(422, { error: 'Unsupported', code: 'unsupported_type' }))
    const unsupported = await requestStructure(postRequest({}), routeContext())
    expect(unsupported.status).toBe(422)
    await expect(unsupported.json()).resolves.toEqual({ error: 'Unsupported', code: 'unsupported_type' })
  })

  it('stops before the command when a mutation guard blocks the request', async () => {
    mockGuardInstances.push({
      id: 'test.block',
      targetEntity: 'attachments.attachment',
      operations: ['update'],
      validate: jest.fn(async () => ({ ok: false, status: 423, message: 'Locked' })),
    })
    const response = await requestStructure(postRequest({}), routeContext())
    expect(response.status).toBe(423)
    expect(mockGuardInstances[0].validate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        resourceKind: 'attachments.attachment',
        resourceId: ATTACHMENT_ID,
        operation: 'update',
      }),
    )
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('applies guard payload changes and survives a failing afterSuccess callback', async () => {
    const afterSuccess = jest.fn(async () => {
      throw new Error('[internal] callback failed')
    })
    mockGuardInstances.push({
      id: 'test.modify',
      targetEntity: 'attachments.*',
      operations: ['update'],
      validate: jest.fn(async () => ({ ok: true, modifiedPayload: { ocr: 'never' }, shouldRunAfterSuccess: true })),
      afterSuccess,
    })
    commandBus.execute.mockResolvedValue({
      result: { attachmentId: ATTACHMENT_ID, extractionId: null, status: 'pending', enqueued: true },
      logEntry: null,
    })
    const response = await requestStructure(postRequest({ force: true }), routeContext())
    expect(response.status).toBe(202)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'attachments.document_structure.request',
      expect.objectContaining({ input: expect.objectContaining({ force: true, ocr: 'never' }) }),
    )
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })
})
