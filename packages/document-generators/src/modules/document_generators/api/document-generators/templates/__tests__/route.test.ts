import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { templateRegistry } from '../../../../lib/template-registry'
import { resolveDocumentRequestContext } from '../../../_shared/request-context'
import { GET, metadata, openApi } from '../route'

jest.mock('../../../_shared/request-context', () => ({ resolveDocumentRequestContext: jest.fn() }))

const translate = (key: string, fallback?: string) => (key === 'sales.offer.label' ? 'Oferta' : fallback ?? key)

function makeEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'sales.offer', label: 'sales.offer.label', description: 'Offer', module: 'sales',
    resourceKind: 'sales.quote', documentType: 'offer', format: 'pdf', tags: ['sales', 'quote'],
    fromRecord: () => ({ id: 'x' }), resourceId: () => 'x', filename: () => 'x.pdf', load: async () => ({}),
    ...overrides,
  }
}

const userHasAllFeatures = jest.fn()
const resolveForRequest = jest.fn()

function setContext(auth: Record<string, unknown> | null) {
  const container = {
    resolve: (name: string) => {
      if (name === 'rbacService') return { userHasAllFeatures }
      if (name === 'organizationScopeService') return { resolveForRequest }
      throw new Error(`unknown ${name}`)
    },
  }
  ;(resolveDocumentRequestContext as jest.Mock).mockResolvedValue({ container, auth, translate, locale: 'en' })
}

const baseAuth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
const call = (query = '') => GET(new Request(`http://localhost/api/document-generators/templates${query}`))

beforeAll(() => {
  templateRegistry.register([
    makeEntry(),
    makeEntry({ id: 'sales.invoice', resourceKind: 'sales.order', documentType: 'invoice', format: 'md', tags: ['invoice'], requiredFeatures: ['sales.orders.view'] }),
    makeEntry({ id: 'sales.note', resourceKind: 'sales.order', documentType: 'note', format: 'md', tags: ['note'], requiredFeatures: ['sales.orders.view'] }),
  ])
})

beforeEach(() => {
  userHasAllFeatures.mockReset().mockResolvedValue(true)
  resolveForRequest.mockReset().mockResolvedValue({ selectedId: 'org-selected', allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
  setContext(baseAuth)
})

describe('templates route', () => {
  it('declares its public path and guards', () => {
    expect(metadata).toEqual({
      path: '/document-generators/templates',
      GET: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
    })
    expect(openApi.methods.GET?.operationId).toBeTruthy()
  })

  it('answers 401 without auth', async () => {
    setContext(null)
    expect((await call()).status).toBe(401)
  })

  it('lists templates with translated labels', async () => {
    const body = await (await call()).json()
    expect(body.map((item: { id: string }) => item.id).sort()).toEqual(['sales.invoice', 'sales.note', 'sales.offer'])
    expect(body.find((item: { id: string }) => item.id === 'sales.offer').label).toBe('Oferta')
  })

  it('maps snake_case query filters including repeated tags', async () => {
    const body = await (await call('?resource_kind=sales.order&document_type=invoice&format=md&tags=invoice&tags=missing')).json()
    expect(body.map((item: { id: string }) => item.id)).toEqual(['sales.invoice'])
    const byTags = await (await call('?tags=quote&tags=note')).json()
    expect(byTags.map((item: { id: string }) => item.id).sort()).toEqual(['sales.note', 'sales.offer'])
  })

  it('answers 400 invalid_query for a malformed query', async () => {
    const response = await call('?format=')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_query')
  })

  it('omits unauthorized templates instead of rejecting and checks RBAC once per feature set in the selected organization', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await call()
    expect(response.status).toBe(200)
    expect((await response.json()).map((item: { id: string }) => item.id)).toEqual(['sales.offer'])
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: 'org-selected' })
  })

  it('falls back to the raw auth when no organization can be resolved', async () => {
    resolveForRequest.mockResolvedValue({ selectedId: null, allowedIds: [], filterIds: [], tenantId: 'tenant-1', selectionRejected: true })
    await call()
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
