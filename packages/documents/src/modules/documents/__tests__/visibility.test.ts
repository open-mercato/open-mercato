import type { EntityManager } from '@mikro-orm/postgresql'
import { Document, DocumentFolder } from '../data/entities'
import {
  getFolderPlacementIssue,
  getVisibleDocumentPage,
  getVisibleFolders,
  hasActiveFolderContents,
  wouldCreateFolderCycle,
} from '../lib/visibility'
import { DOCUMENTS_MAX_FOLDER_DEPTH } from '../lib/constants'

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

function makeQueryDouble(rows: Array<Record<string, unknown>>, count = 0): QueryDouble {
  const query = {} as QueryDouble
  query.select = jest.fn(() => query)
  query.where = jest.fn(() => query)
  query.andWhere = jest.fn(() => query)
  query.orderBy = jest.fn(() => query)
  query.limit = jest.fn(() => query)
  query.offset = jest.fn(() => query)
  query.execute = jest.fn(async () => rows)
  query.getCount = jest.fn(async () => count)
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
  roleIds: ['44444444-4444-4444-8444-444444444444'],
}

describe('visible document page query', () => {
  it('returns ordered page tiers and the window total from one query', async () => {
    const query = makeQueryDouble([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', relationshipTier: 'editor', total: '17' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relationshipTier: 'viewer', total: '17' },
    ])

    const result = await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 2,
      pageSize: 2,
      search: 'Quarterly',
      folderId: '55555555-5555-4555-8555-555555555555',
    })

    expect(result).toEqual({
      rows: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', relationshipTier: 'editor', total: 17 },
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relationshipTier: 'viewer', total: 17 },
      ],
      total: 17,
    })
    expect(query.execute).toHaveBeenCalledTimes(1)
    expect(query.limit).toHaveBeenCalledWith(2)
    expect(query.offset).toHaveBeenCalledWith(2)
    expect(query.andWhere.mock.calls.some(([condition]) => (
      typeof condition === 'string' && condition.includes('exists')
    ))).toBe(true)
  })

  it('escapes LIKE wildcards in the search term so % and _ match literally', async () => {
    const query = makeQueryDouble([])

    await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
      search: ' 50%_off\\deal ',
    })

    expect(query.andWhere).toHaveBeenCalledWith(
      'document.title ilike ?',
      ['%50\\%\\_off\\\\deal%'],
    )
  })

  it('keeps the same single-query shape for a 100-row page', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      relationshipTier: 'commenter',
      total: 100,
    }))
    const query = makeQueryDouble(rows)

    const result = await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 100,
    })

    expect(result.rows).toHaveLength(100)
    expect(query.execute).toHaveBeenCalledTimes(1)
  })

  it('falls back to a scoped count for an empty out-of-range page', async () => {
    const query = makeQueryDouble([], 17)
    const em = makeEntityManager(query)

    await expect(getVisibleDocumentPage({
      em,
      ...scope,
      managerOverride: false,
      page: 3,
      pageSize: 10,
      search: 'Quarterly',
    })).resolves.toEqual({ rows: [], total: 17 })

    expect(query.execute).toHaveBeenCalledTimes(1)
    expect(query.getCount).toHaveBeenCalledWith('document.id')
    expect(em.createQueryBuilder).toHaveBeenCalledTimes(2)
  })

  it('lets manager override remove only the relationship visibility predicate', async () => {
    const query = makeQueryDouble([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', relationshipTier: null, total: 1n },
    ])

    const result = await getVisibleDocumentPage({
      em: makeEntityManager(query),
      ...scope,
      managerOverride: true,
      page: 1,
      pageSize: 10,
    })

    expect(result.rows[0]).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      relationshipTier: null,
      total: 1,
    })
    expect(query.andWhere).not.toHaveBeenCalled()
  })

  it('keeps a high-cardinality relation filter inside the paginated SQL query', async () => {
    const query = makeQueryDouble([])
    const em = makeEntityManager(query)
    const entityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

    await expect(getVisibleDocumentPage({
      em,
      ...scope,
      managerOverride: false,
      page: 1,
      pageSize: 10,
      relationFilter: { entityType: 'customer-person', entityId },
    })).resolves.toEqual({ rows: [], total: 0 })

    expect(query.execute).toHaveBeenCalledTimes(1)
    const relationCall = query.andWhere.mock.calls.find(([condition]) => (
      typeof condition === 'string' && condition.includes('document_entity_links as relation_link')
    ))
    expect(relationCall).toBeTruthy()
    expect(relationCall?.[0]).toContain('relation_link.customer_entity_id = ?')
    expect(relationCall?.[0]).toContain('relation_link.customer_kind = ?')
    expect(relationCall?.[1]).toEqual([
      scope.tenantId,
      scope.organizationId,
      entityId,
      'person',
    ])
    expect(query.limit).toHaveBeenCalledWith(10)
  })
})

function folder(
  id: string,
  ownerUserId: string,
  parentFolderId: string | null,
  name: string,
): DocumentFolder {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ownerUserId,
    parentFolderId,
    name,
    createdAt: new Date('2026-07-10T10:00:00.000Z'),
    updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    deletedAt: null,
  } as DocumentFolder
}

describe('visible document folders', () => {
  it('returns only owned, directly visible, and required ancestor folders', async () => {
    const ancestor = folder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other-user', null, 'Ancestor')
    const visible = folder('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other-user', ancestor.id, 'Visible')
    const owned = folder('cccccccc-cccc-4ccc-8ccc-cccccccccccc', scope.userId, ancestor.id, 'Owned')
    const unrelated = folder('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'other-user', null, 'Unrelated')
    const query = makeQueryDouble([{ folderId: visible.id }])
    const find = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.ownerUserId === scope.userId) return [owned]
      const idFilter = where.id as { $in?: string[] } | undefined
      return [ancestor, visible, unrelated].filter((candidate) => idFilter?.$in?.includes(candidate.id))
    })
    const em = {
      createQueryBuilder: jest.fn(() => query),
      find,
    } as unknown as EntityManager

    const rows = await getVisibleFolders({
      em,
      ...scope,
      managerOverride: false,
      canEditAction: true,
    })

    expect(rows.map((row) => ({
      id: row.folder.id,
      visibility: row.visibility,
      canEdit: row.canEdit,
    }))).toEqual(expect.arrayContaining([
      { id: owned.id, visibility: 'owned', canEdit: true },
      { id: visible.id, visibility: 'contains-visible', canEdit: false },
      { id: ancestor.id, visibility: 'ancestor', canEdit: false },
    ]))
    expect(rows.some((row) => row.folder.id === unrelated.id)).toBe(false)
  })

  it('keeps the full scoped tree writable for manager override', async () => {
    const folders = [
      folder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other-user', null, 'Alpha'),
      folder('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scope.userId, null, 'Beta'),
    ]
    const em = {
      find: jest.fn(async () => folders),
    } as unknown as EntityManager

    const rows = await getVisibleFolders({
      em,
      ...scope,
      managerOverride: true,
      canEditAction: true,
    })

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.canEdit && row.visibility === 'owned')).toBe(true)
  })

  it('keeps owned and manager-visible folders read-only without documents.edit', async () => {
    const owned = folder(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scope.userId,
      null,
      'Owned',
    )
    const managerVisible = folder(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'other-user',
      null,
      'Manager visible',
    )
    const query = makeQueryDouble([])
    const ownerEm = {
      createQueryBuilder: jest.fn(() => query),
      find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (
        where.ownerUserId === scope.userId ? [owned] : []
      )),
    } as unknown as EntityManager
    const managerEm = {
      find: jest.fn(async () => [managerVisible]),
    } as unknown as EntityManager

    const ownerRows = await getVisibleFolders({
      em: ownerEm,
      ...scope,
      managerOverride: false,
      canEditAction: false,
    })
    const managerRows = await getVisibleFolders({
      em: managerEm,
      ...scope,
      managerOverride: true,
      canEditAction: false,
    })

    expect(ownerRows).toHaveLength(1)
    expect(ownerRows[0]?.canEdit).toBe(false)
    expect(managerRows).toHaveLength(1)
    expect(managerRows[0]?.canEdit).toBe(false)
  })

  it('rejects an over-depth visible chain instead of exposing a truncated child as a root', async () => {
    const folders = Array.from({ length: DOCUMENTS_MAX_FOLDER_DEPTH + 1 }, (_, index) => folder(
      `folder-${index}`,
      'other-user',
      index === 0 ? null : `folder-${index - 1}`,
      `Folder ${index}`,
    ))
    const leaf = folders[folders.length - 1]!
    const byId = new Map(folders.map((entry) => [entry.id, entry]))
    const query = makeQueryDouble([{ folderId: leaf.id }])
    const em = {
      createQueryBuilder: jest.fn(() => query),
      find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
        if (where.ownerUserId === scope.userId) return []
        const ids = (where.id as { $in: string[] }).$in
        return ids.flatMap((id) => byId.get(id) ?? [])
      }),
    } as unknown as EntityManager

    await expect(getVisibleFolders({
      em,
      ...scope,
      managerOverride: false,
      canEditAction: true,
    })).rejects.toThrow('Folder hierarchy exceeds the supported depth')
  })

  it('rejects scoped hierarchy cycles for manager visibility', async () => {
    const first = folder('first', scope.userId, 'second', 'First')
    const second = folder('second', scope.userId, first.id, 'Second')
    const em = {
      find: jest.fn(async () => [first, second]),
    } as unknown as EntityManager

    await expect(getVisibleFolders({
      em,
      ...scope,
      managerOverride: true,
      canEditAction: true,
    })).rejects.toThrow('Folder hierarchy contains a cycle')
  })
})

describe('folder mutation integrity', () => {
  it('rejects moving a folder beneath its descendant with scoped bounded traversal', async () => {
    const root = folder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scope.userId, null, 'Root')
    const child = folder('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scope.userId, root.id, 'Child')
    const grandchild = folder('cccccccc-cccc-4ccc-8ccc-cccccccccccc', scope.userId, child.id, 'Grandchild')
    const byId = new Map([root, child, grandchild].map((entry) => [entry.id, entry]))
    const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => (
      entity === DocumentFolder ? byId.get(String(where.id)) ?? null : null
    ))
    const em = { findOne } as unknown as EntityManager

    await expect(wouldCreateFolderCycle({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      folderId: root.id,
      parentFolderId: grandchild.id,
    })).resolves.toBe(true)

    expect(findOne).toHaveBeenCalled()
    for (const [, where] of findOne.mock.calls) {
      expect(where).toMatchObject({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
    }
  })

  it('allows a parent chain that does not reach the moved folder', async () => {
    const target = folder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scope.userId, null, 'Target')
    const parent = folder('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scope.userId, null, 'Parent')
    const em = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (
        entity === DocumentFolder && where.id === parent.id ? parent : null
      )),
    } as unknown as EntityManager

    await expect(wouldCreateFolderCycle({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      folderId: target.id,
      parentFolderId: parent.id,
    })).resolves.toBe(false)
  })

  it('allows a create at the depth boundary and rejects the next level', async () => {
    const folders = Array.from({ length: DOCUMENTS_MAX_FOLDER_DEPTH }, (_, index) => folder(
      `folder-${index}`,
      scope.userId,
      index === 0 ? null : `folder-${index - 1}`,
      `Folder ${index}`,
    ))
    const byId = new Map(folders.map((entry) => [entry.id, entry]))
    const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (
      byId.get(String(where.id)) ?? null
    ))
    const em = { findOne } as unknown as EntityManager

    await expect(getFolderPlacementIssue({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      parentFolderId: folders[DOCUMENTS_MAX_FOLDER_DEPTH - 2]!.id,
    })).resolves.toBeNull()
    await expect(getFolderPlacementIssue({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      parentFolderId: folders[DOCUMENTS_MAX_FOLDER_DEPTH - 1]!.id,
    })).resolves.toBe('depth')

    for (const [, where] of findOne.mock.calls) {
      expect(where).toMatchObject({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
    }
  })

  it('includes the moved subtree height when enforcing the depth boundary', async () => {
    const ancestors = Array.from({ length: DOCUMENTS_MAX_FOLDER_DEPTH - 1 }, (_, index) => folder(
      `ancestor-${index}`,
      scope.userId,
      index === 0 ? null : `ancestor-${index - 1}`,
      `Ancestor ${index}`,
    ))
    const moved = folder('moved', scope.userId, null, 'Moved')
    const child = folder('moved-child', scope.userId, moved.id, 'Moved child')
    const byId = new Map(ancestors.map((entry) => [entry.id, entry]))
    const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (
      byId.get(String(where.id)) ?? null
    ))
    const find = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      const parentIds = (where.parentFolderId as { $in: string[] }).$in
      return [child].filter((entry) => parentIds.includes(entry.parentFolderId!))
    })
    const em = { findOne, find } as unknown as EntityManager

    await expect(getFolderPlacementIssue({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      folderId: moved.id,
      parentFolderId: ancestors[DOCUMENTS_MAX_FOLDER_DEPTH - 3]!.id,
    })).resolves.toBeNull()
    await expect(getFolderPlacementIssue({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      folderId: moved.id,
      parentFolderId: ancestors[DOCUMENTS_MAX_FOLDER_DEPTH - 2]!.id,
    })).resolves.toBe('depth')

    for (const [, where] of find.mock.calls) {
      expect(where).toMatchObject({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
    }
  })

  it('detects active child folders or documents without exposing their data', async () => {
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const child = folder('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scope.userId, targetId, 'Child')
    const findOne = jest.fn(async (entity: unknown) => entity === DocumentFolder ? child : null)
    const em = { findOne } as unknown as EntityManager

    await expect(hasActiveFolderContents({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      folderId: targetId,
    })).resolves.toBe(true)

    expect(findOne).toHaveBeenCalledWith(DocumentFolder, expect.objectContaining({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      parentFolderId: targetId,
    }), expect.anything())
    expect(findOne).toHaveBeenCalledWith(Document, expect.objectContaining({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      folderId: targetId,
    }), expect.anything())
  })

  it('allows deleting an empty scoped folder', async () => {
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    await expect(hasActiveFolderContents({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      folderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).resolves.toBe(false)
  })
})
