import { Document } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

const mockResolvePermission = jest.fn(async () => 'owner')
const mockResolveUserLabels = jest.fn(async () => new Map())

jest.mock('../lib/permissions', () => {
  const actual = jest.requireActual('../lib/permissions')
  return { ...actual, resolvePermission: (...args: unknown[]) => mockResolvePermission(...args) }
})

jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? 'Unknown user' }),
}))

const archivedAt: { value: Date | null } = { value: null }

const em = {
  find: jest.fn(async () => []),
  findOne: jest.fn(async (entity: unknown) => entity === Document ? {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ownerUserId: USER_ID,
    archivedAt: archivedAt.value,
    deletedAt: null,
  } : null),
}

jest.mock('../api/_shared', () => {
  const actual = jest.requireActual('../api/_shared')
  return {
    ...actual,
    resolveDocumentsContext: async () => ({
      container: { resolve: jest.fn(() => undefined) },
      em,
      auth: {
        sub: USER_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
        orgId: ORGANIZATION_ID,
        organizationId: ORGANIZATION_ID,
        features: ['documents.view', 'documents.edit'],
        roleIds: [],
        resolvedRoleIds: [],
        isSuperAdmin: false,
      },
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      request: new Request('http://localhost'),
    }),
  }
})

import { GET } from '../api/[id]/collab-token/route'

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/collab-token`)
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('collaboration token capability resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    archivedAt.value = null
    mockResolvePermission.mockResolvedValue('owner')
    mockResolveUserLabels.mockResolvedValue(new Map())
  })

  it('resolves the document relationship once per token request', async () => {
    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    // The client refreshes this endpoint on a 60s TTL and on every reconnect;
    // both the pre-archive and post-archive projections share one lookup.
    expect(mockResolvePermission).toHaveBeenCalledTimes(1)
  })

  it('still derives the archived projection from that single lookup', async () => {
    archivedAt.value = new Date('2026-07-18T10:00:00.000Z')

    const response = await GET(request(), context())
    const body = await response.json() as { tier: string; canEdit: boolean; readOnly: boolean }

    expect(mockResolvePermission).toHaveBeenCalledTimes(1)
    expect(body.tier).toBe('owner')
    expect(body.canEdit).toBe(false)
    expect(body.readOnly).toBe(true)
  })

  it('refuses a caller with no relationship before reading the document', async () => {
    mockResolvePermission.mockResolvedValue(null as unknown as 'owner')

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
