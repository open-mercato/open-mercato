/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgAId = '22222222-2222-4222-8222-222222222222'
const orgBId = '33333333-3333-4333-8333-333333333333'
const orgParentId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'
const orgADictionaryId = '66666666-6666-4666-8666-666666666666'
const parentDictionaryId = '77777777-7777-4777-8777-777777777777'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const context = {
  container,
  ctx: {
    container,
    auth: { tenantId, sub: userId, orgId: orgAId },
    organizationScope: {
      tenantId,
      selectedId: orgBId,
      filterIds: [orgBId],
      allowedIds: [orgAId, orgBId],
    },
    selectedOrganizationId: orgBId,
    organizationIds: [orgBId],
    request: null,
  },
  auth: { tenantId, sub: userId, orgId: orgAId },
  em,
  organizationId: orgBId,
  tenantId,
  readableOrganizationIds: [orgBId],
  translate: (_key: string, fallback?: string) => fallback ?? 'error',
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => context),
  resolveDictionaryActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) =>
    emInstance.findOne(entity, filters, opts),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn(async (_tenantId: string, fn: () => unknown) => fn()),
}))

import { GET as listDictionaries } from '../route'
import { GET as getDictionary } from '../[dictionaryId]/route'
import { GET as listEntries } from '../[dictionaryId]/entries/route'

describe('dictionaries read routes organization scope isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    context.organizationId = orgBId
    context.readableOrganizationIds = [orgBId]
    em.fork.mockReturnValue(em)
  })

  it('filters GET /api/dictionaries by readableOrganizationIds (excluding Org A when Org B is selected)', async () => {
    em.find.mockResolvedValueOnce([])

    const response = await listDictionaries(new Request('http://localhost/api/dictionaries'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: { $in: [orgBId] },
        tenantId,
        deletedAt: null,
        isActive: true,
      },
      { orderBy: { name: 'asc' } },
    )
  })

  it('returns 404 on GET /api/dictionaries/[dictionaryId] when targeting Org A dictionary from Org B', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const response = await getDictionary(
      new Request(`http://localhost/api/dictionaries/${orgADictionaryId}`),
      { params: { dictionaryId: orgADictionaryId } },
    )

    expect(response.status).toBe(404)
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: orgADictionaryId,
        tenantId,
        deletedAt: null,
        organizationId: { $in: [orgBId] },
      },
    )
  })

  it('returns 200 with isInherited=true on GET /api/dictionaries/[dictionaryId] for an ancestor dictionary', async () => {
    context.readableOrganizationIds = [orgBId, orgParentId]
    em.findOne.mockResolvedValueOnce({
      id: parentDictionaryId,
      key: 'shared_tags',
      name: 'Shared Tags',
      description: null,
      isSystem: false,
      isActive: true,
      managerVisibility: 'default',
      entrySortMode: 'label_asc',
      organizationId: orgParentId,
      tenantId,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      updatedAt: new Date('2026-05-01T10:00:00.000Z'),
    })

    const response = await getDictionary(
      new Request(`http://localhost/api/dictionaries/${parentDictionaryId}`),
      { params: { dictionaryId: parentDictionaryId } },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.id).toBe(parentDictionaryId)
    expect(body.isInherited).toBe(true)
  })

  it('returns 404 on GET /api/dictionaries/[dictionaryId]/entries when targeting Org A dictionary from Org B', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const response = await listEntries(
      new Request(`http://localhost/api/dictionaries/${orgADictionaryId}/entries`),
      { params: { dictionaryId: orgADictionaryId } },
    )

    expect(response.status).toBe(404)
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: orgADictionaryId,
        tenantId,
        deletedAt: null,
        organizationId: { $in: [orgBId] },
      },
    )
    expect(em.count).not.toHaveBeenCalled()
  })
})
