import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { CatalogProductCategory } from '../../data/entities'
import { categoryCreateSchema, categoryUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { computeHierarchyForCategories } from '../../lib/categoryHierarchy'

const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.categories.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.categories.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.categories.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.categories.manage'] },
}

export const routeMetadata = metadata
export { metadata }

const rawBodySchema = z.object({}).passthrough()

const viewSchema = z
  .object({
    view: z.enum(['manage', 'tree']).default('manage'),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    status: z.enum(['all', 'active', 'inactive']).optional(),
    ids: z.string().optional(),
  })
  .passthrough()

type QueryShape = z.infer<typeof viewSchema>

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: CatalogProductCategory,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  actions: {
    create: {
      commandId: 'catalog.categories.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(categoryCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.categoryId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.categories.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(categoryUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.categories.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Record identifier is required.') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

type ManageCategoryRow = {
  id: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  parentName: string | null
  depth: number
  treePath: string
  pathLabel: string
  childCount: number
  descendantCount: number
  isActive: boolean
  organizationId: string
  tenantId: string
}

type TreeNode = {
  id: string
  name: string
  parentId: string | null
  depth: number
  pathLabel: string
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  isActive: boolean
  children: TreeNode[]
}

function sanitizeSearch(term?: string | null): string {
  if (!term) return ''
  return term.trim().toLowerCase()
}

function parseIds(raw?: string | null): string[] | null {
  if (!raw) return null
  const parts = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
  return parts.length ? Array.from(new Set(parts)) : null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [] }, { status: 401 })

  const url = new URL(req.url)
  const parsed = viewSchema.safeParse({
    view: url.searchParams.get('view') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    ids: url.searchParams.get('ids') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], error: 'Invalid query' }, { status: 400 })
  }
  const query: QueryShape = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const { translate } = await resolveTranslations()

  const tenantId = scope?.tenantId ?? auth.tenantId ?? null
  if (!tenantId) {
    return NextResponse.json(
      { items: [], error: translate('catalog.errors.tenant_required', 'Tenant context is required.') },
      { status: 400 }
    )
  }

  const allowed = scope?.filterIds ?? scope?.allowedIds ?? (auth.orgId ? [auth.orgId] : null)
  const preferredOrg = scope?.selectedId ?? auth.orgId ?? null
  const organizationId = preferredOrg ?? (Array.isArray(allowed) && allowed.length ? allowed[0]! : null)

  if (!organizationId || (Array.isArray(allowed) && allowed.length && !allowed.includes(organizationId))) {
    return NextResponse.json(
      { items: [], error: translate('catalog.errors.organization_required', 'Organization context is required.') },
      { status: 400 }
    )
  }

  const categories = await em.find(
    CatalogProductCategory,
    { organizationId, tenantId, deletedAt: null },
    { orderBy: { name: 'ASC' } }
  )
  const categoryMap = new Map(categories.map((cat) => [String(cat.id), cat]))
  const hierarchy = computeHierarchyForCategories(categories)

  if (query.view === 'tree') {
    const nodes = new Map<string, TreeNode>()
    const roots: TreeNode[] = []
    for (const entry of hierarchy.ordered) {
      const node: TreeNode = {
        id: entry.id,
        name: entry.name,
        parentId: entry.parentId,
        depth: entry.depth,
        pathLabel: entry.pathLabel,
        ancestorIds: entry.ancestorIds,
        childIds: entry.childIds,
        descendantIds: entry.descendantIds,
        isActive: entry.isActive,
        children: [],
      }
      nodes.set(entry.id, node)
      if (entry.parentId && nodes.has(entry.parentId)) {
        nodes.get(entry.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    return NextResponse.json({ items: roots })
  }

  const status = query.status ?? 'all'
  const search = sanitizeSearch(query.search ?? null)
  const ids = parseIds(query.ids)
  const idSet = ids ? new Set(ids) : null
  let rows = hierarchy.ordered

  if (status === 'active') rows = rows.filter((node) => node.isActive)
  if (status === 'inactive') rows = rows.filter((node) => !node.isActive)
  if (search) {
    rows = rows.filter((node) => {
      const label = node.pathLabel.toLowerCase()
      return node.name.toLowerCase().includes(search) || label.includes(search)
    })
  }
  if (idSet && idSet.size) {
    rows = rows.filter((node) => idSet.has(node.id))
  }

  const total = rows.length
  const pageSize = query.pageSize
  const page = query.page
  const start = (page - 1) * pageSize
  const paged = rows.slice(start, start + pageSize)

  const recordIds = paged.map((node) => node.id)
  const tenantIdByRecord: Record<string, string | null> = {}
  const organizationIdByRecord: Record<string, string | null> = {}
  for (const id of recordIds) {
    tenantIdByRecord[id] = tenantId
    organizationIdByRecord[id] = organizationId
  }
  const cfValues = recordIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.catalog.catalog_product_category,
        recordIds,
        tenantIdByRecord,
        organizationIdByRecord,
        tenantFallbacks: tenantId ? [tenantId] : [],
      })
    : {}

  const items: ManageCategoryRow[] = paged.map((node) => {
    const category = categoryMap.get(node.id)
    const parentName = node.parentId ? hierarchy.map.get(node.parentId)?.name ?? null : null
    const recordId = node.id
    return {
      id: recordId,
      name: node.name,
      slug: category?.slug ?? null,
      description: category?.description ?? null,
      parentId: node.parentId,
      parentName,
      depth: node.depth,
      treePath: node.treePath,
      pathLabel: node.pathLabel,
      childCount: node.childIds.length,
      descendantCount: node.descendantIds.length,
      isActive: node.isActive,
      organizationId,
      tenantId,
      ...(cfValues[recordId] ?? {}),
    }
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages,
    organizationId,
    tenantId,
  })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
