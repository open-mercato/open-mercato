import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { getVisibleDocumentPage } from '../lib/visibility'
import { getEntityRegistryEntry } from '../lib/entityRegistry'
import {
  buildDocumentEntityLinkTarget,
  getDocumentEntityLinkEntityId,
  getDocumentEntityLinkType,
} from '../lib/entityLinks'
import type { DocumentEntityLink } from '../data/entities'

type QueryDouble = {
  select: jest.Mock
  where: jest.Mock
  andWhere: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  offset: jest.Mock
  execute: jest.Mock
  getCount: jest.Mock
}

function makeQueryDouble(rows: Array<Record<string, unknown>> = []): QueryDouble {
  const query = {} as QueryDouble
  query.select = jest.fn(() => query)
  query.where = jest.fn(() => query)
  query.andWhere = jest.fn(() => query)
  query.orderBy = jest.fn(() => query)
  query.limit = jest.fn(() => query)
  query.offset = jest.fn(() => query)
  query.execute = jest.fn(async () => rows)
  query.getCount = jest.fn(async () => 0)
  return query
}

function makeEntityManager(query: QueryDouble): EntityManager {
  return {
    createQueryBuilder: jest.fn(() => query),
  } as unknown as EntityManager
}

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  roleIds: [] as string[],
}

const exactDocumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function whereConditions(query: QueryDouble): Record<string, unknown> {
  expect(query.where).toHaveBeenCalledTimes(1)
  return query.where.mock.calls[0]![0] as Record<string, unknown>
}

function joinedAndWhereSql(query: QueryDouble): string {
  return query.andWhere.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('M9 list visibility filters', () => {
  it('excludes archived documents by default', async () => {
    const query = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
    })
    expect(whereConditions(query)).toMatchObject({ archivedAt: null })
  })

  it('narrows to archived-only when requested', async () => {
    const query = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
      archived: 'only',
    })
    expect(whereConditions(query)).toMatchObject({ archivedAt: { $ne: null } })
  })

  it('applies no archived condition for archived=include', async () => {
    const query = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
      archived: 'include',
    })
    expect(Object.keys(whereConditions(query))).not.toContain('archivedAt')
  })

  it('makes the exact-id lookup archived-inclusive while still narrowing to the id', async () => {
    const query = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 1,
      id: exactDocumentId,
      archived: 'exclude',
    })
    const conditions = whereConditions(query)
    expect(conditions).toMatchObject({ id: exactDocumentId })
    expect(Object.keys(conditions)).not.toContain('archivedAt')
  })

  it('keeps the visibility predicate on the exact-id lookup', async () => {
    const query = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 1,
      id: exactDocumentId,
    })
    expect(query.andWhere).toHaveBeenCalled()
  })

  it('adds a tenant- and user-scoped favorites predicate only when requested', async () => {
    const withFavorite = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(withFavorite),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
      favoriteUserId: scope.userId,
    })
    const favoriteCall = withFavorite.andWhere.mock.calls.find((call) =>
      String(call[0]).includes('document_favorites'),
    )
    expect(favoriteCall).toBeDefined()
    expect(favoriteCall?.[1]).toEqual([scope.tenantId, scope.organizationId, scope.userId])

    const withoutFavorite = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(withoutFavorite),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
    })
    expect(joinedAndWhereSql(withoutFavorite)).not.toContain('document_favorites')
  })

  it('supports the document relation filter for backlinks', async () => {
    const query = makeQueryDouble()
    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
      relationFilter: { entityType: 'document', entityId: exactDocumentId },
    })
    const relationSql = joinedAndWhereSql(query)
    expect(relationSql).toContain('linked_document_id')
  })
})

describe('M9 favorite filter boolean semantics', () => {
  it('treats favorite=false and absent values as no filter and only accepts true tokens', () => {
    expect(parseBooleanWithDefault('false', false)).toBe(false)
    expect(parseBooleanWithDefault('0', false)).toBe(false)
    expect(parseBooleanWithDefault(undefined, false)).toBe(false)
    expect(parseBooleanWithDefault('true', false)).toBe(true)
    expect(parseBooleanWithDefault('1', false)).toBe(true)
  })
})

describe('M9 document link target write mapping', () => {
  it('writes document links into linked_document_id, never a peer target column', () => {
    const target = buildDocumentEntityLinkTarget('document', exactDocumentId)
    expect(target.linkedDocumentId).toBe(exactDocumentId)
    expect(target.salesOrderId).toBeNull()
    expect(target.customerEntityId).toBeNull()
    expect(target.dealId).toBeNull()
    expect(target.productId).toBeNull()
    expect(target.catalogOfferId).toBeNull()
    expect(target.quoteId).toBeNull()
  })

  it('keeps sales-order writes on their own column', () => {
    const target = buildDocumentEntityLinkTarget('sales-order', exactDocumentId)
    expect(target.salesOrderId).toBe(exactDocumentId)
    expect(target.linkedDocumentId).toBeNull()
  })

  it('round-trips a persisted document link back to its type and id', () => {
    const link = {
      customerEntityId: null,
      customerKind: null,
      dealId: null,
      productId: null,
      catalogOfferId: null,
      quoteId: null,
      salesOrderId: null,
      linkedDocumentId: exactDocumentId,
    } as unknown as DocumentEntityLink
    expect(getDocumentEntityLinkType(link)).toBe('document')
    expect(getDocumentEntityLinkEntityId(link)).toBe(exactDocumentId)
  })
})

describe('M9 document registry entry', () => {
  const entry = getEntityRegistryEntry('document')

  it('declares the fail-closed documents-owned entry', () => {
    expect(entry).not.toBeNull()
    expect(entry?.searchPath).toBe('/api/documents')
    expect(entry?.requiredModule).toBe('documents')
    expect(entry?.requiredFeatureModule).toBe('documents')
    expect(entry?.requiredFeature).toBe('documents.view')
    expect(entry?.tokenFields.map((tokenField) => tokenField.field)).toEqual(['title'])
  })

  it('maps items to safe labels and canonical hrefs', () => {
    const mapped = entry?.mapItem({ id: exactDocumentId, title: 'Quarterly SOP' })
    expect(mapped).toMatchObject({ id: exactDocumentId, label: 'Quarterly SOP' })
    const href = mapped ? entry?.resolveHref(mapped) : null
    expect(href).toBe(`/backend/documents/${exactDocumentId}`)
    expect(mapped && href ? entry?.isCanonicalHref(mapped, href) : false).toBe(true)
  })

  it('rejects identifier-shaped titles instead of leaking them as labels', () => {
    expect(entry?.mapItem({ id: exactDocumentId, title: exactDocumentId })).toBeNull()
  })

  it('passes archived metadata through for badge rendering', () => {
    const mapped = entry?.mapItem({
      id: exactDocumentId,
      title: 'Archived SOP',
      archivedAt: '2026-07-01T00:00:00.000Z',
    }) as { archivedAt?: string | null } | null
    expect(mapped?.archivedAt).toBe('2026-07-01T00:00:00.000Z')
  })
})
