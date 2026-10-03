import { resolveDocumentRequestContext } from '../../../_shared/request-context'
import { GenerationHistoryService } from '../../../../services/generation-history-service'
import { GET, metadata, openApi } from '../route'

jest.mock('../../../_shared/request-context', () => ({ resolveDocumentRequestContext: jest.fn() }))
jest.mock('../../../../services/generation-history-service', () => ({ GenerationHistoryService: jest.fn() }))

const translate = (key: string, fallback?: string) => (key === 'document_generators.errors.invalid_query' ? 'Zapytanie niepoprawne' : fallback ?? key)

const listAndCount = jest.fn()
const resolveForRequest = jest.fn()
const baseAuth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
const USER_ID = '8f0e1c3e-6a3c-4f56-9d2a-1d6a7f9f2b11'

function setContext(auth: Record<string, unknown> | null) {
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return {}
      if (name === 'organizationScopeService') return { resolveForRequest }
      throw new Error(`unknown ${name}`)
    },
  }
  ;(resolveDocumentRequestContext as jest.Mock).mockResolvedValue({ container, auth, translate, locale: 'en' })
}

const call = (query = '') => GET(new Request(`http://localhost/api/document-generators/documents${query}`))

beforeEach(() => {
  listAndCount.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  ;(GenerationHistoryService as unknown as jest.Mock).mockReset().mockImplementation(() => ({ listAndCount }))
  resolveForRequest.mockReset().mockResolvedValue({ selectedId: 'org-selected', allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
  setContext(baseAuth)
})

describe('documents history route', () => {
  it('declares its public path and guards', () => {
    expect(metadata).toEqual({
      path: '/document-generators/documents',
      GET: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
    })
    expect(openApi.methods.GET?.operationId).toBeTruthy()
  })

  it('answers 401 without auth', async () => {
    setContext(null)
    expect((await call()).status).toBe(401)
    expect(listAndCount).not.toHaveBeenCalled()
  })

  it('applies defaults and scopes by the selected organization', async () => {
    const items = [{ id: 'doc-1' }]
    listAndCount.mockResolvedValue({ items, total: 1, page: 1, pageSize: 20 })
    const response = await call('?organizationId=other-org&tenantId=other-tenant')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items, total: 1, page: 1, pageSize: 20 })
    const [scope, query] = listAndCount.mock.calls[0]
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-selected' })
    expect(query).toMatchObject({ page: 1, pageSize: 20, sort: 'generated_at', sort_direction: 'desc' })
  })

  it('forwards filters, sort and paging to the service', async () => {
    await call(`?page=2&pageSize=50&resource_kind=sales.order&resource_id=o-1&template_id=sales.invoice&generated_by=${USER_ID}&generated_from=2026-01-01T00:00:00Z&generated_to=2026-02-01T00:00:00Z&sort=template_label&sort_direction=asc`)
    expect(listAndCount.mock.calls[0][1]).toMatchObject({
      page: 2,
      pageSize: 50,
      resource_kind: 'sales.order',
      resource_id: 'o-1',
      template_id: 'sales.invoice',
      generated_by: USER_ID,
      generated_from: '2026-01-01T00:00:00Z',
      generated_to: '2026-02-01T00:00:00Z',
      sort: 'template_label',
      sort_direction: 'asc',
    })
  })

  it.each([
    ['unsortable field', '?sort=resource_label'],
    ['non-uuid generated_by', '?generated_by=not-a-uuid'],
    ['inverted range', '?generated_from=2026-02-01T00:00:00Z&generated_to=2026-01-01T00:00:00Z'],
    ['oversized page', '?pageSize=101'],
    ['lone resource_kind', '?resource_kind=sales.order'],
  ])('answers 400 invalid_query for %s', async (_label, query) => {
    const response = await call(query)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_query', message: 'Zapytanie niepoprawne' })
    expect(listAndCount).not.toHaveBeenCalled()
  })

  it('answers an empty page when no organization is active', async () => {
    resolveForRequest.mockResolvedValue({ selectedId: null, allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
    setContext({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
    const response = await call('?page=3&pageSize=10')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], total: 0, page: 3, pageSize: 10 })
    expect(listAndCount).not.toHaveBeenCalled()
  })

  it('maps unexpected service errors to render_failed', async () => {
    listAndCount.mockRejectedValue(new Error('boom'))
    const response = await call()
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('render_failed')
  })
})
