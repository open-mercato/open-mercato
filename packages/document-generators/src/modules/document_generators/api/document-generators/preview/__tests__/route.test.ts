import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { templateRegistry } from '../../../../lib/template-registry'
import { DocumentRenderer } from '../../../../services/document-renderer'
import { resolveDocumentRequestContext } from '../../../_shared/request-context'
import { POST, metadata, openApi } from '../route'

jest.mock('../../../_shared/request-context', () => ({ resolveDocumentRequestContext: jest.fn() }))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}))

const translate = (_key: string, fallback?: string) => fallback ?? _key
const fetchData = jest.fn()
const userHasAllFeatures = jest.fn()
const resolveForRequest = jest.fn()
const resolveSpy = jest.fn()
const renderSpy = jest.spyOn(DocumentRenderer.prototype, 'render')

function makeEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'sales.offer', label: 'Offer', description: 'Offer', module: 'sales',
    resourceKind: 'sales.quote', documentType: 'offer', format: 'md', tags: [],
    fromRecord: (record) => record as Record<string, unknown>,
    resourceId: ({ data }) => String(data.id ?? ''),
    filename: () => 'zażółć offer.md',
    load: async () => ({ markdown: () => '# Offer' }) as never,
    fetchData,
    ...overrides,
  }
}

let moduleConfig: unknown

function setContext(auth: Record<string, unknown> | null) {
  const container = {
    resolve: (name: string) => {
      resolveSpy(name)
      if (name === 'rbacService') return { userHasAllFeatures }
      if (name === 'organizationScopeService') return { resolveForRequest }
      if (name === 'documentGeneratorsConfig' && moduleConfig !== undefined) return moduleConfig
      throw new Error(`unknown ${name}`)
    },
  }
  ;(resolveDocumentRequestContext as jest.Mock).mockResolvedValue({ container, auth, translate, locale: 'pl' })
  return container
}

const baseAuth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
const call = (body: unknown) => POST(new Request('http://localhost/api/document-generators/preview', {
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
}))
const valid = { template_id: 'sales.offer', data: { quoteId: 'q-1' } }

beforeAll(() => {
  templateRegistry.register([
    makeEntry(),
    makeEntry({ id: 'sales.restricted', requiredFeatures: ['sales.quotes.manage'] }),
  ])
})

beforeEach(() => {
  fetchData.mockReset().mockResolvedValue({ id: 'q-1' })
  userHasAllFeatures.mockReset().mockResolvedValue(true)
  resolveForRequest.mockReset().mockResolvedValue({ selectedId: 'org-selected', allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
  resolveSpy.mockReset()
  moduleConfig = undefined
  renderSpy.mockClear()
  renderSpy.mockImplementation(async () => ({ buffer: new TextEncoder().encode('# Offer'), format: 'md', mimeType: 'text/markdown' }))
  setContext(baseAuth)
})

describe('preview route', () => {
  it('declares its public path and guards', () => {
    expect(metadata).toEqual({
      path: '/document-generators/preview',
      POST: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
    })
    expect(openApi.methods.POST?.operationId).toBeTruthy()
  })

  it('answers 401 without auth', async () => {
    setContext(null)
    expect((await call(valid)).status).toBe(401)
    expect(fetchData).not.toHaveBeenCalled()
  })

  it('answers 400 invalid_json for a malformed body', async () => {
    const response = await call('{nope')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_json')
  })

  it.each([
    ['missing template_id', { data: {} }],
    ['extra resource_id', { ...valid, resource_id: 'x' }],
  ])('answers 400 invalid_request for %s', async (_label, body) => {
    const response = await call(body)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_request')
    expect(fetchData).not.toHaveBeenCalled()
  })

  it('answers 409 when no organization is selected', async () => {
    setContext({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
    resolveForRequest.mockResolvedValue({ selectedId: null, allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
    const response = await call(valid)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('organization_required')
    expect(fetchData).not.toHaveBeenCalled()
  })

  it('answers 400 unknown_template', async () => {
    const response = await call({ template_id: 'nope.missing', data: {} })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('unknown_template')
  })

  it('answers 403 with requiredFeatures and never loads source data', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await call({ template_id: 'sales.restricted', data: {} })
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('forbidden')
    expect(body.requiredFeatures).toEqual(['sales.quotes.manage'])
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.quotes.manage'], { tenantId: 'tenant-1', organizationId: 'org-selected' })
    expect(fetchData).not.toHaveBeenCalled()
    expect(renderSpy).not.toHaveBeenCalled()
  })

  it('maps source not_found to 404', async () => {
    fetchData.mockRejectedValue(new CrudHttpError(404, { error: 'not_found' }))
    const response = await call(valid)
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('not_found')
  })

  it('maps source invalid_request to 400', async () => {
    fetchData.mockRejectedValue(new CrudHttpError(400, { error: 'invalid_request' }))
    const response = await call(valid)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_request')
  })

  it('answers 500 render_failed without leaking the cause', async () => {
    renderSpy.mockRejectedValue(new Error('secret-internal-detail'))
    const response = await call(valid)
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text).error).toBe('render_failed')
    expect(text).not.toContain('secret-internal-detail')
  })

  it('returns the rendered bytes with download headers and the scoped load context', async () => {
    const response = await call(valid)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/markdown')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toContain("filename*=UTF-8''za%C5%BC%C3%B3%C5%82%C4%87%20offer.md")
    expect(await response.text()).toBe('# Offer')
    expect(fetchData).toHaveBeenCalledTimes(1)
    const [input, context] = fetchData.mock.calls[0]
    expect(input).toEqual({ data: { quoteId: 'q-1' } })
    expect(context.auth).toMatchObject({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-selected' })
    expect(typeof context.container.resolve).toBe('function')
  })

  it('passes the module configuration from the container to the renderer', async () => {
    await call(valid)
    expect(renderSpy.mock.calls[0][1]).toEqual({ config: { providers: [] } })

    renderSpy.mockClear()
    moduleConfig = { providers: [{ id: 'react-pdf', config: { fontFamily: 'Times-Roman' } }] }
    await call(valid)
    expect(renderSpy.mock.calls[0][1]).toEqual({ config: { providers: [{ id: 'react-pdf', config: { fontFamily: 'Times-Roman' } }] } })
  })

  it('has no side effects: only rbac, organization scope and module config are resolved', async () => {
    await call(valid)
    const resolved = new Set(resolveSpy.mock.calls.map(([name]) => name))
    const readOnly = new Set(['rbacService', 'organizationScopeService', 'documentGeneratorsConfig'])
    expect([...resolved].every((name) => readOnly.has(name))).toBe(true)
  })
})
