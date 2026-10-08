import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerMutationGuards, type MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { templateRegistry } from '../../../../lib/template-registry'
import { DocumentRenderer } from '../../../../services/document-renderer'
import { GenerationHistoryService } from '../../../../services/generation-history-service'
import { resolveDocumentRequestContext } from '../../../_shared/request-context'
import { POST, metadata, openApi } from '../route'

jest.mock('../../../_shared/request-context', () => ({ resolveDocumentRequestContext: jest.fn() }))
const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
jest.mock('@open-mercato/shared/lib/logger', () => {
  const lazy: Record<string, unknown> = {}
  for (const level of ['error', 'warn', 'info', 'debug']) {
    lazy[level] = (...args: unknown[]) => (mockLogger as Record<string, (...a: unknown[]) => void>)[level](...args)
  }
  lazy.child = () => lazy
  return { createLogger: () => lazy }
})
const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }) }))

const translate = (_key: string, fallback?: string) => fallback ?? _key
const fetchData = jest.fn()
const userHasAllFeatures = jest.fn()
const getGrantedFeatures = jest.fn()
const resolveForRequest = jest.fn()
const renderSpy = jest.spyOn(DocumentRenderer.prototype, 'render')
const prepareSpy = jest.spyOn(GenerationHistoryService.prototype, 'prepare')
const persistSpy = jest.spyOn(GenerationHistoryService.prototype, 'persist')

function makeEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'sales.offer', label: 'Offer', description: 'Offer', module: 'sales',
    resourceKind: 'sales.quote', documentType: 'offer', format: 'md', tags: [],
    fromRecord: (record) => record as Record<string, unknown>,
    resourceId: ({ data }) => String(data.id ?? ''),
    filename: () => 'offer.md',
    load: async () => ({ markdown: () => '# Offer' }) as never,
    fetchData,
    ...overrides,
  }
}

let attachmentServiceMock: Record<string, unknown> | undefined

let moduleConfig: unknown

function setContext(auth: Record<string, unknown> | null) {
  const container = {
    resolve: (name: string) => {
      if (name === 'rbacService') return { userHasAllFeatures, getGrantedFeatures }
      if (name === 'documentGeneratorsConfig' && moduleConfig !== undefined) return moduleConfig
      if (name === 'organizationScopeService') return { resolveForRequest }
      if (name === 'em') return {}
      if (name === 'attachmentService' && attachmentServiceMock) return attachmentServiceMock
      throw new Error(`unknown ${name}`)
    },
  }
  ;(resolveDocumentRequestContext as jest.Mock).mockResolvedValue({ container, auth, translate, locale: 'pl' })
}

function makeGuard(overrides: Partial<MutationGuard> = {}): MutationGuard {
  return {
    id: 'test.guard', targetEntity: '*', operations: ['create'],
    validate: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

const USER_ID = '3f6c2a1e-8b4d-4c7a-9e21-5d0b7a6c4f10'
const BOUND_USER_ID = '7a1d9c3b-2e5f-4b8a-8c6d-0f4e3a2b1c90'
const API_KEY_ID = 'c2b4e6a8-1d3f-4a5c-9b7e-2f4d6a8c0e12'
const baseAuth = { sub: USER_ID, tenantId: 'tenant-1', orgId: 'org-1' }
const call = (body: unknown) => POST(new Request('http://localhost/api/document-generators/generate', {
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
}))
const valid = { template_id: 'sales.offer', data: { id: 'q-1' } }

beforeAll(() => {
  templateRegistry.register([
    makeEntry(),
    makeEntry({ id: 'sales.restricted', requiredFeatures: ['sales.quotes.manage'] }),
  ])
})

beforeEach(() => {
  fetchData.mockReset().mockResolvedValue({ id: 'q-1', name: 'Quote Q-1' })
  userHasAllFeatures.mockReset().mockResolvedValue(true)
  getGrantedFeatures.mockReset().mockResolvedValue(['document_generators.documents.generate'])
  resolveForRequest.mockReset().mockResolvedValue({ selectedId: 'org-selected', allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
  mockLogger.error.mockClear()
  mockReportError.mockClear()
  registerMutationGuards([])
  renderSpy.mockReset().mockResolvedValue({ buffer: new TextEncoder().encode('# Offer'), format: 'md', mimeType: 'text/markdown' })
  moduleConfig = undefined
  prepareSpy.mockReset().mockImplementation(async (input) => ({ entity: { ...input } as never, plaintextResourceLabel: input.resourceLabel || input.resourceId }))
  persistSpy.mockReset().mockResolvedValue({ id: 'history-1' } as never)
  attachmentServiceMock = undefined
  setContext(baseAuth)
})

afterAll(() => registerMutationGuards([]))

describe('generate route', () => {
  it('declares its public path and the generate feature guard', () => {
    expect(metadata).toEqual({
      path: '/document-generators/generate',
      POST: { requireAuth: true, requireFeatures: ['document_generators.documents.generate'] },
    })
    expect(openApi.methods.POST?.operationId).toBeTruthy()
  })

  it('answers 401 without auth', async () => {
    setContext(null)
    expect((await call(valid)).status).toBe(401)
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['client resource_kind', { ...valid, resource_kind: 'sales.order' }],
    ['client resource_id', { ...valid, resource_id: 'x' }],
    ['missing template_id', { data: {} }],
  ])('answers 400 invalid_request for %s', async (_label, body) => {
    const response = await call(body)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_request')
    expect(fetchData).not.toHaveBeenCalled()
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('answers 409 without an organization', async () => {
    setContext({ sub: USER_ID, tenantId: 'tenant-1', orgId: null })
    resolveForRequest.mockResolvedValue({ selectedId: null, allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
    expect((await call(valid)).status).toBe(409)
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('answers 403 for a restricted template and never loads, renders or persists', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await call({ template_id: 'sales.restricted', data: {} })
    expect(response.status).toBe(403)
    expect((await response.json()).requiredFeatures).toEqual(['sales.quotes.manage'])
    expect(fetchData).not.toHaveBeenCalled()
    expect(renderSpy).not.toHaveBeenCalled()
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('maps source errors', async () => {
    fetchData.mockRejectedValueOnce(new CrudHttpError(404, { error: 'not_found' }))
    expect((await call(valid)).status).toBe(404)
    fetchData.mockRejectedValueOnce(new CrudHttpError(400, { error: 'invalid_request' }))
    expect((await call(valid)).status).toBe(400)
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('answers 500 render_failed without leaking the cause and persists nothing', async () => {
    renderSpy.mockRejectedValue(new Error('secret-internal-detail'))
    const response = await call(valid)
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text).error).toBe('render_failed')
    expect(text).not.toContain('secret-internal-detail')
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('returns the guard rejection status and body and persists nothing', async () => {
    const guard = makeGuard({ validate: jest.fn().mockResolvedValue({ ok: false, status: 423, body: { error: 'locked' } }) })
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])
    const response = await call(valid)
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'locked' })
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('runs guards as a create on the generated document with tenant, organization and user', async () => {
    const guard = makeGuard()
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])
    await call(valid)
    expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-selected',
      userId: USER_ID,
      operation: 'create',
      resourceKind: 'document_generators.generated_document',
      resourceId: null,
      requestMethod: 'POST',
      mutationPayload: expect.objectContaining({ source_resource_kind: 'sales.quote', source_resource_id: 'q-1' }),
    }))
  })

  it('passes the module configuration from the container to the renderer', async () => {
    await call(valid)
    expect(renderSpy.mock.calls[0][1]).toEqual({ config: { providers: [] } })

    renderSpy.mockClear()
    moduleConfig = { providers: [{ id: 'react-pdf', config: { fontFamily: 'Times-Roman' } }] }
    await call(valid)
    expect(renderSpy.mock.calls[0][1]).toEqual({ config: { providers: [{ id: 'react-pdf', config: { fontFamily: 'Times-Roman' } }] } })
  })

  it('records history with the canonical identity, label fallback and selected-organization scope', async () => {
    const response = await call(valid)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    expect(await response.text()).toBe('# Offer')
    expect(prepareSpy).toHaveBeenCalledTimes(1)
    expect(prepareSpy.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-selected',
      resourceKind: 'sales.quote',
      resourceId: 'q-1',
      resourceLabel: undefined,
      templateId: 'sales.offer',
      templateLabel: 'Offer',
      templateVersion: '1',
      format: 'md',
      mimeType: 'text/markdown',
      generatedBy: USER_ID,
    })
    expect(persistSpy).toHaveBeenCalledTimes(1)
  })

  it('prefers auth.userId over auth.sub for generated_by', async () => {
    setContext({ ...baseAuth, userId: BOUND_USER_ID })
    await call(valid)
    expect(prepareSpy.mock.calls[0][0].generatedBy).toBe(BOUND_USER_ID)
  })

  it('records a user-less API key by its key id so history and the stored file survive', async () => {
    setContext({ sub: `api_key:${API_KEY_ID}`, isApiKey: true, keyId: API_KEY_ID, tenantId: 'tenant-1', orgId: 'org-1' })
    const response = await call(valid)
    expect(response.status).toBe(200)
    expect(prepareSpy.mock.calls[0][0].generatedBy).toBe(API_KEY_ID)
    expect(persistSpy).toHaveBeenCalledTimes(1)
  })

  it('records a user-bound API key by the bound user', async () => {
    setContext({ sub: `api_key:${API_KEY_ID}`, isApiKey: true, keyId: API_KEY_ID, userId: BOUND_USER_ID, tenantId: 'tenant-1', orgId: 'org-1' })
    await call(valid)
    expect(prepareSpy.mock.calls[0][0].generatedBy).toBe(BOUND_USER_ID)
  })

  it('answers 403 before rendering when the caller has no recordable identity', async () => {
    setContext({ ...baseAuth, sub: 'not-a-uuid' })
    const response = await call(valid)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('forbidden')
    expect(prepareSpy).not.toHaveBeenCalled()
  })

  it('still returns the document and logs and reports when persisting fails', async () => {
    persistSpy.mockRejectedValue(new Error('db down'))
    const guard = makeGuard({ afterSuccess: jest.fn(), validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }) })
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])
    const response = await call(valid)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('# Offer')
    expect(mockLogger.error).toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(guard.afterSuccess).not.toHaveBeenCalled()
  })

  it('stores the document as a private attachment linked to its history row in one transaction', async () => {
    const txPersist = jest.fn()
    const txFlush = jest.fn(async () => undefined)
    const tx = { persist: jest.fn((entity: unknown) => { txPersist(entity); return { flush: txFlush } }) }
    const createScoped = jest.fn(async (input: { persistLink: (tx: unknown, id: string) => Promise<void> }) => {
      await input.persistLink(tx, 'attachment-1')
      return { id: 'attachment-1' }
    })
    attachmentServiceMock = { createScoped, readScoped: jest.fn() }
    prepareSpy.mockImplementation(async (input) => ({ entity: { ...input, id: 'history-9' } as never, plaintextResourceLabel: input.resourceId }))
    const guard = makeGuard({ afterSuccess: jest.fn(), validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }) })
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    expect((await call(valid)).status).toBe(200)
    expect(createScoped).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'document_generators:document',
      recordId: 'q-1',
      tenantId: 'tenant-1',
      organizationId: 'org-selected',
      partitionCode: 'privateAttachments',
      declaredMimeType: 'text/markdown',
    }))
    expect(createScoped.mock.calls[0][0]).not.toHaveProperty('assignments')
    expect(txPersist).toHaveBeenCalledWith(expect.objectContaining({ id: 'history-9', attachmentId: 'attachment-1' }))
    expect(txFlush).toHaveBeenCalled()
    expect(persistSpy).not.toHaveBeenCalled()
    expect(guard.afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'history-9' }))
  })

  it('falls back to history without a stored file when storage fails', async () => {
    attachmentServiceMock = { createScoped: jest.fn().mockRejectedValue(new Error('quota exceeded')), readScoped: jest.fn() }
    const response = await call(valid)
    expect(response.status).toBe(200)
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'document_generators.document_storage_failed' }))
  })

  it('runs afterSuccess callbacks after the row commits with the history id', async () => {
    const guard = makeGuard({ afterSuccess: jest.fn(), validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { a: 1 } }) })
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])
    expect((await call(valid)).status).toBe(200)
    expect(guard.afterSuccess).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'document_generators.generated_document',
      resourceId: 'history-1',
      operation: 'create',
      metadata: { a: 1 },
    }))
  })

  it('isolates a throwing afterSuccess callback: still 200, logged, later callbacks still run', async () => {
    const failing = makeGuard({ id: 'a', priority: 1, afterSuccess: jest.fn().mockRejectedValue(new Error('boom')), validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }) })
    const later = makeGuard({ id: 'b', priority: 2, afterSuccess: jest.fn(), validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }) })
    registerMutationGuards([{ moduleId: 'test', guards: [failing, later] }])
    const response = await call(valid)
    expect(response.status).toBe(200)
    expect(mockLogger.error).toHaveBeenCalledWith('Mutation guard afterSuccess failed', expect.objectContaining({ guardId: 'a' }))
    expect(later.afterSuccess).toHaveBeenCalled()
  })

  it('fails the request without persisting when history preparation (encryption) fails', async () => {
    prepareSpy.mockRejectedValue(new Error('[internal] encryption unavailable'))
    const response = await call(valid)
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('render_failed')
    expect(persistSpy).not.toHaveBeenCalled()
  })
})
