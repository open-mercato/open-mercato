import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Document, DocumentFolder } from '../data/entities'
import type { DocumentEntityType } from '../data/validators'
import { DOCUMENTS_MAX_FOLDER_DEPTH, DOCUMENTS_MAX_LISTED_FOLDERS } from './constants'
import type { DocumentTier } from './permissions'

export type VisibleDocumentPageRow = {
  id: string
  relationshipTier: DocumentTier | null
  total: number
}

export type VisibleDocumentPage = {
  rows: VisibleDocumentPageRow[]
  total: number
}

export type GetVisibleDocumentPageInput = {
  em: EntityManager
  tenantId: string
  organizationId: string
  userId: string
  roleIds: readonly string[]
  managerOverride: boolean
  page: number
  pageSize: number
  id?: string | null
  archived?: 'exclude' | 'include' | 'only'
  favoriteUserId?: string | null
  search?: string | null
  folderId?: string | null
  relationFilter?: { entityType: DocumentEntityType; entityId: string } | null
}

export type FolderVisibility = 'owned' | 'contains-visible' | 'ancestor'

export type VisibleFolderRow = {
  folder: DocumentFolder
  canEdit: boolean
  visibility: FolderVisibility
}

export type GetVisibleFoldersInput = Pick<
  GetVisibleDocumentPageInput,
  'em' | 'tenantId' | 'organizationId' | 'userId' | 'roleIds' | 'managerOverride'
> & {
  canEditAction: boolean
}

export type FolderMutationScope = Pick<
  GetVisibleFoldersInput,
  'em' | 'tenantId' | 'organizationId'
>

export type FolderPlacementIssue = 'cycle' | 'depth' | 'missing-parent'

type RawVisibleDocumentRow = {
  id?: unknown
  relationshipTier?: unknown
  relationship_tier?: unknown
  total?: unknown
}

type RawFolderIdRow = {
  folderId?: unknown
  folder_id?: unknown
}

type PrincipalPredicate = {
  sql: string
  params: string[]
}

type VisibilityPredicateQuery = {
  andWhere(condition: string, params?: string[]): unknown
}

function normalizeRoleIds(roleIds: readonly string[]): string[] {
  return Array.from(new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean)))
}

function principalPredicate(
  shareAlias: string,
  userId: string,
  roleIds: readonly string[],
): PrincipalPredicate {
  const normalizedRoleIds = normalizeRoleIds(roleIds)
  if (normalizedRoleIds.length === 0) {
    return {
      sql: `(${shareAlias}.principal_type = 'user' and ${shareAlias}.principal_id = ?)`,
      params: [userId],
    }
  }

  const rolePlaceholders = normalizedRoleIds.map(() => '?').join(', ')
  return {
    sql: `(
      (${shareAlias}.principal_type = 'user' and ${shareAlias}.principal_id = ?)
      or (${shareAlias}.principal_type = 'role' and ${shareAlias}.principal_id in (${rolePlaceholders}))
    )`,
    params: [userId, ...normalizedRoleIds],
  }
}

function activeSharePredicate(
  shareAlias: string,
  documentAlias: string,
  input: Pick<GetVisibleDocumentPageInput, 'tenantId' | 'organizationId' | 'userId' | 'roleIds'>,
): PrincipalPredicate {
  const principal = principalPredicate(shareAlias, input.userId, input.roleIds)
  return {
    sql: `
      ${shareAlias}.document_id = ${documentAlias}.id
      and ${shareAlias}.tenant_id = ?
      and ${shareAlias}.organization_id = ?
      and ${shareAlias}.deleted_at is null
      and ${principal.sql}
    `,
    params: [input.tenantId, input.organizationId, ...principal.params],
  }
}

function relationshipTierSelection(input: GetVisibleDocumentPageInput) {
  const share = activeSharePredicate('tier_share', 'document', input)
  return raw(`
    case
      when document.owner_user_id = ? then 'owner'
      else (
        select tier_share.permission
        from document_shares as tier_share
        where ${share.sql}
        order by case tier_share.permission
          when 'editor' then 3
          when 'commenter' then 2
          when 'viewer' then 1
          else 0
        end desc
        limit 1
      )
    end as "relationshipTier"
  `, [input.userId, ...share.params])
}

function addDocumentVisibilityPredicate(
  query: VisibilityPredicateQuery,
  input: Pick<
    GetVisibleDocumentPageInput,
    'tenantId' | 'organizationId' | 'userId' | 'roleIds' | 'managerOverride'
  >,
): void {
  if (input.managerOverride) return
  const share = activeSharePredicate('visible_share', 'document', input)
  query.andWhere(`(
    document.owner_user_id = ?
    or exists (
      select 1
      from document_shares as visible_share
      where ${share.sql}
    )
  )`, [input.userId, ...share.params])
}

const RELATION_TARGET_COLUMNS: Record<DocumentEntityType, string> = {
  'customer-person': 'customer_entity_id',
  'customer-company': 'customer_entity_id',
  deal: 'deal_id',
  product: 'product_id',
  'catalog-offer': 'catalog_offer_id',
  quote: 'quote_id',
  'sales-order': 'sales_order_id',
  document: 'linked_document_id',
}

function addDocumentRelationPredicate(
  query: VisibilityPredicateQuery,
  input: Pick<GetVisibleDocumentPageInput, 'tenantId' | 'organizationId' | 'relationFilter'>,
): void {
  if (!input.relationFilter) return
  const column = RELATION_TARGET_COLUMNS[input.relationFilter.entityType]
  const customerKind = input.relationFilter.entityType === 'customer-person'
    ? 'person'
    : input.relationFilter.entityType === 'customer-company'
      ? 'company'
      : null
  query.andWhere(`exists (
    select 1
    from document_entity_links as relation_link
    where relation_link.document_id = document.id
      and relation_link.tenant_id = ?
      and relation_link.organization_id = ?
      and relation_link.deleted_at is null
      and relation_link.${column} = ?
      ${customerKind ? 'and relation_link.customer_kind = ?' : ''}
  )`, [
    input.tenantId,
    input.organizationId,
    input.relationFilter.entityId,
    ...(customerKind ? [customerKind] : []),
  ])
}

function addDocumentFavoritePredicate(
  query: VisibilityPredicateQuery,
  input: Pick<
    GetVisibleDocumentPageInput,
    'tenantId' | 'organizationId' | 'favoriteUserId'
  >,
): void {
  if (!input.favoriteUserId) return
  query.andWhere(`exists (
    select 1
    from document_favorites as document_favorite
    where document_favorite.document_id = document.id
      and document_favorite.tenant_id = ?
      and document_favorite.organization_id = ?
      and document_favorite.user_id = ?
      and document_favorite.deleted_at is null
  )`, [input.tenantId, input.organizationId, input.favoriteUserId])
}

function normalizeTier(value: unknown): DocumentTier | null {
  return value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer'
    ? value
    : null
}

function normalizeTotal(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function assertPageInput(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('[internal] Invalid visible document page request')
  }
}

function buildVisibleDocumentQuery(input: GetVisibleDocumentPageInput) {
  const archived = input.archived ?? 'exclude'
  const query = input.em
    .createQueryBuilder(Document, 'document')
    .where({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      ...(input.id ? { id: input.id } : {}),
      ...(!input.id && archived === 'exclude' ? { archivedAt: null } : {}),
      ...(!input.id && archived === 'only' ? { archivedAt: { $ne: null } } : {}),
    })

  addDocumentVisibilityPredicate(query, input)
  addDocumentRelationPredicate(query, input)
  addDocumentFavoritePredicate(query, input)
  if (input.search?.trim()) {
    query.andWhere('document.title ilike ?', [`%${escapeLikePattern(input.search.trim())}%`])
  }
  if (input.folderId) {
    query.andWhere({ folderId: input.folderId })
  }
  return query
}

export async function getVisibleDocumentPage(
  input: GetVisibleDocumentPageInput,
): Promise<VisibleDocumentPage> {
  assertPageInput(input.page, input.pageSize)

  const query = buildVisibleDocumentQuery(input)
    .select([
      'document.id',
      relationshipTierSelection(input),
      raw('count(*) over() as "total"'),
    ])
  const rawRows = await query
    .orderBy({ updatedAt: 'DESC', id: 'ASC' })
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize)
    .execute<RawVisibleDocumentRow[]>('all', false)

  const rows = rawRows.flatMap((row): VisibleDocumentPageRow[] => {
    if (typeof row.id !== 'string' || row.id.length === 0) return []
    return [{
      id: row.id,
      relationshipTier: normalizeTier(row.relationshipTier ?? row.relationship_tier),
      total: normalizeTotal(row.total),
    }]
  })
  if (rows.length > 0 || input.page === 1) {
    return { rows, total: rows[0]?.total ?? 0 }
  }

  // A window count has no carrier row when the requested offset is beyond the
  // last page. Keep the fast one-query path for normal pages and issue one
  // bounded fallback count only for an empty out-of-range page.
  const total = await buildVisibleDocumentQuery(input).getCount('document.id')
  return { rows, total: normalizeTotal(total) }
}

async function getDirectVisibleFolderIds(input: GetVisibleFoldersInput): Promise<Set<string>> {
  const query = input.em
    .createQueryBuilder(Document, 'document')
    .select('document.folderId', true)
    .where({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      folderId: { $ne: null },
    })
  addDocumentVisibilityPredicate(query, input)

  const rows = await query.execute<RawFolderIdRow[]>('all')
  return new Set(rows.flatMap((row) => {
    const folderId = row.folderId ?? row.folder_id
    return typeof folderId === 'string' && folderId.length > 0 ? [folderId] : []
  }))
}

function assertFolderHierarchyContract(
  foldersById: ReadonlyMap<string, DocumentFolder>,
  requiredFolderIds?: Iterable<string>,
): void {
  if (requiredFolderIds) {
    for (const folderId of requiredFolderIds) {
      if (!foldersById.has(folderId)) {
        throw new Error('[internal] Visible folder hierarchy contains an unresolved folder')
      }
    }
  }

  for (const folder of foldersById.values()) {
    const visited = new Set<string>()
    let current: DocumentFolder | undefined = folder
    let depth = 0
    while (current) {
      if (visited.has(current.id)) {
        throw new Error('[internal] Folder hierarchy contains a cycle')
      }
      visited.add(current.id)
      depth += 1
      if (depth > DOCUMENTS_MAX_FOLDER_DEPTH) {
        throw new Error('[internal] Folder hierarchy exceeds the supported depth')
      }
      if (!current.parentFolderId) break
      current = foldersById.get(current.parentFolderId)
      if (!current) {
        throw new Error('[internal] Folder hierarchy contains an unresolved ancestor')
      }
    }
  }
}

/**
 * Truncating a name-ordered listing can cut a parent while keeping its
 * children. Retaining only what a root still reaches leaves a coherent tree the
 * organization can prune back under the cap, instead of failing the whole
 * listing on an ancestor the bound removed.
 */
function retainFoldersReachableFromRoots(folders: readonly DocumentFolder[]): DocumentFolder[] {
  const childrenByParentId = new Map<string, DocumentFolder[]>()
  for (const folder of folders) {
    if (!folder.parentFolderId) continue
    const siblings = childrenByParentId.get(folder.parentFolderId)
    if (siblings) siblings.push(folder)
    else childrenByParentId.set(folder.parentFolderId, [folder])
  }

  const reachableIds = new Set<string>()
  const pending = folders.filter((folder) => !folder.parentFolderId)
  for (let index = 0; index < pending.length; index += 1) {
    const folder = pending[index]
    reachableIds.add(folder.id)
    const children = childrenByParentId.get(folder.id)
    if (children) pending.push(...children)
  }
  return folders.filter((folder) => reachableIds.has(folder.id))
}

export async function getVisibleFolders(input: GetVisibleFoldersInput): Promise<VisibleFolderRow[]> {
  const scope = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    deletedAt: null,
  }
  if (input.managerOverride) {
    const folders = await findWithDecryption(
      input.em,
      DocumentFolder,
      scope,
      { orderBy: { name: 'ASC' }, limit: DOCUMENTS_MAX_LISTED_FOLDERS + 1 },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    // Creation is capped well below this bound, so only an organization that
    // predates the cap can overflow. Degrade that one to a listable subtree
    // rather than letting the hierarchy contract reject the whole listing.
    const listed = folders.length > DOCUMENTS_MAX_LISTED_FOLDERS
      ? retainFoldersReachableFromRoots(folders.slice(0, DOCUMENTS_MAX_LISTED_FOLDERS))
      : folders
    assertFolderHierarchyContract(new Map(listed.map((folder) => [folder.id, folder])))
    return listed.map((folder) => ({
      folder,
      canEdit: input.canEditAction,
      visibility: 'owned',
    }))
  }

  const [ownedFolders, directlyVisibleFolderIds] = await Promise.all([
    findWithDecryption(
      input.em,
      DocumentFolder,
      { ...scope, ownerUserId: input.userId },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    ),
    getDirectVisibleFolderIds(input),
  ])
  const foldersById = new Map(ownedFolders.map((folder) => [folder.id, folder]))
  const visibilityById = new Map<string, FolderVisibility>()
  for (const folder of ownedFolders) visibilityById.set(folder.id, 'owned')
  for (const folderId of directlyVisibleFolderIds) {
    if (!visibilityById.has(folderId)) visibilityById.set(folderId, 'contains-visible')
  }

  let pendingIds = new Set<string>([
    ...directlyVisibleFolderIds,
    ...ownedFolders.flatMap((folder) => folder.parentFolderId ? [folder.parentFolderId] : []),
  ].filter((folderId) => !foldersById.has(folderId)))

  for (let depth = 0; pendingIds.size > 0 && depth < DOCUMENTS_MAX_FOLDER_DEPTH; depth += 1) {
    const batchIds = Array.from(pendingIds)
    pendingIds = new Set()
    const folders = await findWithDecryption(
      input.em,
      DocumentFolder,
      {
        ...scope,
        id: { $in: batchIds },
      },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    for (const folder of folders) {
      foldersById.set(folder.id, folder)
      if (!visibilityById.has(folder.id)) visibilityById.set(folder.id, 'ancestor')
      if (folder.parentFolderId && !foldersById.has(folder.parentFolderId)) {
        pendingIds.add(folder.parentFolderId)
      }
    }
  }

  if (pendingIds.size > 0) {
    throw new Error('[internal] Folder hierarchy exceeds the supported depth')
  }
  assertFolderHierarchyContract(foldersById, visibilityById.keys())

  return Array.from(foldersById.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((folder) => ({
      folder,
      canEdit: input.canEditAction && folder.ownerUserId === input.userId,
      visibility: visibilityById.get(folder.id) ?? 'ancestor',
    }))
}

type AncestorInspection = {
  depth: number
  issue: FolderPlacementIssue | null
}

async function inspectFolderAncestors(
  input: FolderMutationScope & { folderId?: string | null; parentFolderId: string | null },
): Promise<AncestorInspection> {
  const scope = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    deletedAt: null,
  }
  const visited = new Set<string>()
  let ancestorId = input.parentFolderId
  let depth = 0

  while (ancestorId) {
    if (ancestorId === input.folderId || visited.has(ancestorId)) {
      return { depth, issue: 'cycle' }
    }
    if (depth >= DOCUMENTS_MAX_FOLDER_DEPTH) {
      return { depth, issue: 'depth' }
    }
    visited.add(ancestorId)
    const ancestor = await findOneWithDecryption(
      input.em,
      DocumentFolder,
      {
        ...scope,
        id: ancestorId,
      },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!ancestor) return { depth, issue: 'missing-parent' }
    depth += 1
    ancestorId = ancestor.parentFolderId ?? null
  }

  return { depth, issue: null }
}

async function inspectFolderSubtree(
  input: FolderMutationScope & { folderId: string },
  parentDepth: number,
): Promise<FolderPlacementIssue | null> {
  const scope = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    deletedAt: null,
  }
  const visited = new Set([input.folderId])
  let frontier = [input.folderId]
  let subtreeDepth = 1

  while (frontier.length > 0) {
    if (parentDepth + subtreeDepth > DOCUMENTS_MAX_FOLDER_DEPTH) return 'depth'
    const children = await findWithDecryption(
      input.em,
      DocumentFolder,
      {
        ...scope,
        parentFolderId: { $in: frontier },
      },
      { fields: ['id', 'parentFolderId'] as const },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (children.length === 0) return null

    const nextFrontier: string[] = []
    for (const child of children) {
      if (visited.has(child.id)) return 'cycle'
      visited.add(child.id)
      nextFrontier.push(child.id)
    }
    frontier = nextFrontier
    subtreeDepth += 1
  }

  return null
}

/**
 * Validates a proposed create/move against the same depth contract used by
 * folder visibility. A move includes the deepest descendant of the moved
 * subtree, so relocating a shallow parent cannot push hidden descendants past
 * the supported depth.
 */
export async function getFolderPlacementIssue(
  input: FolderMutationScope & { folderId?: string | null; parentFolderId: string | null },
): Promise<FolderPlacementIssue | null> {
  const ancestors = await inspectFolderAncestors(input)
  if (ancestors.issue) return ancestors.issue
  if (!input.folderId) {
    return ancestors.depth + 1 > DOCUMENTS_MAX_FOLDER_DEPTH ? 'depth' : null
  }
  return inspectFolderSubtree({
    em: input.em,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    folderId: input.folderId,
  }, ancestors.depth)
}

export async function wouldCreateFolderCycle(
  input: FolderMutationScope & { folderId: string; parentFolderId: string },
): Promise<boolean> {
  const inspection = await inspectFolderAncestors(input)
  return inspection.issue === 'cycle' || inspection.issue === 'depth'
}

export async function hasActiveFolderContents(
  input: FolderMutationScope & { folderId: string },
): Promise<boolean> {
  const scope = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    deletedAt: null,
  }
  const [childFolder, document] = await Promise.all([
    findOneWithDecryption(
      input.em,
      DocumentFolder,
      {
        ...scope,
        parentFolderId: input.folderId,
      },
      { fields: ['id'] as const },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    ),
    findOneWithDecryption(
      input.em,
      Document,
      {
        ...scope,
        folderId: input.folderId,
      },
      { fields: ['id'] as const },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    ),
  ])
  return Boolean(childFolder || document)
}
