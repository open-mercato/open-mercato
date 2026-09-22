const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn(async () => undefined)

jest.mock('../api/_shared', () => {
  const actual = jest.requireActual('../api/_shared')
  return {
    ...actual,
    resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
  }
})

jest.mock('../lib/permissions', () => {
  const actual = jest.requireActual('../lib/permissions')
  return { ...actual, assertTier: (...args: unknown[]) => mockAssertTier(...args) }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
  withDocumentsContextErrors: (doc: unknown) => doc,
}))

import { POST, metadata } from '../api/[id]/duplicate/route'

function contextWithFeatures(features: string[]) {
  return {
    container: { resolve: jest.fn() },
    em: { count: jest.fn(async () => 0), find: jest.fn(async () => []) },
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      features,
      roleIds: [],
      resolvedRoleIds: [],
      isSuperAdmin: false,
    },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    request: new Request('http://localhost'),
  }
}

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

function routeContext() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('duplicate route feature gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAssertTier.mockResolvedValue(undefined)
  })

  it('declares both create and edit as required features', () => {
    expect(metadata.POST.requireFeatures).toEqual(['documents.create', 'documents.edit'])
  })

  it.each([
    ['documents.create alone', ['documents.view', 'documents.create']],
    ['documents.edit alone', ['documents.view', 'documents.edit']],
  ])('rejects a caller holding %s', async (_label, features) => {
    mockResolveDocumentsContext.mockResolvedValue(contextWithFeatures(features))

    const response = await POST(request(), routeContext())

    expect(response.status).toBe(403)
    // The gate must fire before any source-document work happens.
    expect(mockAssertTier).not.toHaveBeenCalled()
  })

  it('admits a caller holding both declared features', async () => {
    mockResolveDocumentsContext.mockResolvedValue(
      contextWithFeatures(['documents.view', 'documents.create', 'documents.edit']),
    )

    await POST(request(), routeContext())

    expect(mockAssertTier).toHaveBeenCalledTimes(1)
  })
})
