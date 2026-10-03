import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { templateRegistry } from '../../../../../lib/template-registry'
import { resolveDocumentRequestContext } from '../../../../_shared/request-context'
import { GET, metadata, openApi } from '../route'

jest.mock('../../../../_shared/request-context', () => ({ resolveDocumentRequestContext: jest.fn() }))

function makeEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'sales.offer', label: 'Offer', description: 'Offer', module: 'sales',
    resourceKind: 'sales.quote', documentType: 'offer', format: 'pdf', tags: [],
    fromRecord: () => ({ id: 'x' }), resourceId: () => 'x', filename: () => 'x.pdf', load: async () => ({}),
    ...overrides,
  }
}

const userHasAllFeatures = jest.fn()

function setContext(auth: Record<string, unknown> | null) {
  const container = {
    resolve: (name: string) => {
      if (name === 'rbacService') return { userHasAllFeatures }
      throw new Error(`unknown ${name}`)
    },
  }
  ;(resolveDocumentRequestContext as jest.Mock).mockResolvedValue({ container, auth, translate: (_key: string, fallback?: string) => fallback ?? _key, locale: 'en' })
}

const call = () => GET(new Request('http://localhost/api/document-generators/templates/options'))

beforeAll(() => {
  templateRegistry.register([
    makeEntry(),
    makeEntry({ id: 'secret.report', module: 'secret', resourceKind: 'secret.record', format: 'xlsx', requiredFeatures: ['secret.view'] }),
  ])
})

beforeEach(() => {
  userHasAllFeatures.mockReset().mockImplementation(async (_user: string, features: string[]) => !features.includes('secret.view'))
  setContext({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
})

describe('template options route', () => {
  it('declares its public path and guards', () => {
    expect(metadata).toEqual({
      path: '/document-generators/templates/options',
      GET: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
    })
    expect(openApi.methods.GET?.operationId).toBeTruthy()
  })

  it('answers 401 without auth', async () => {
    setContext(null)
    expect((await call()).status).toBe(401)
  })

  it('derives facets only from authorized templates', async () => {
    const body = await (await call()).json()
    expect(body).toEqual({ resourceKinds: ['sales.quote'], formats: ['pdf'] })
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
  })

  it('includes every facet for a fully authorized user', async () => {
    userHasAllFeatures.mockResolvedValue(true)
    expect(await (await call()).json()).toEqual({ resourceKinds: ['sales.quote', 'secret.record'], formats: ['pdf', 'xlsx'] })
  })
})
