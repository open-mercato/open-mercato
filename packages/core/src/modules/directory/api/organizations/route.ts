/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logCrudAccess, makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { organizationCreateSchema, organizationUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import {
  computeHierarchyForOrganizations,
  rebuildHierarchyForTenant,
  type ComputedOrganizationNode,
} from '@open-mercato/core/modules/directory/lib/hierarchy'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import {
  getSelectedOrganizationFromRequest,
  resolveOrganizationScopeForRequest,
} from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { organizationCrudEvents, organizationCrudIndexer } from '@open-mercato/core/modules/directory/commands/organizations'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  directoryTag,
  directoryErrorSchema,
  directoryOkSchema,
  organizationListResponseSchema,
} from '../openapi'

type CrudInput = Record<string, unknown>
const rawBodySchema = z.object({}).passthrough()

type TreeNode = {
  id: string
  name: string
  parentId: string | null
  tenantId: string | null
  depth: number
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  isActive: boolean
  treePath: string | null
  pathLabel: string
  children: TreeNode[]
}

const viewSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  view: z.enum(['options', 'manage', 'tree']).default('options'),
  ids: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  status: z.enum(['all', 'active', 'inactive']).optional(),
})

function parseIds(raw: string | null): string[] | null {
  if (!raw) return null
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return ids.length ? Array.from(new Set(ids)) : null
}

function stringId(value: unknown): string {
  return String(value)
}

function enforceTenantScope(authTenantId: string | null, requestedTenantId?: string | null): string | null {
  if (authTenantId && requestedTenantId && requestedTenantId !== authTenantId) {
    return null
  }
  return requestedTenantId || authTenantId
}

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['directory.organizations.view'] },
    POST: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
  },
  orm: {
    entity: Organization,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: organizationCrudEvents,
  indexer: organizationCrudIndexer,
  actions: {
    create: {
      commandId: 'directory.organizations.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'directory.organizations.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'directory.organizations.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const metadata = crud.metadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [] }, { status: 401 })

  const url = new URL(req.url)
  const parsed = viewSchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    view: url.searchParams.get('view') ?? undefined,
    ids: url.searchParams.get('ids') ?? undefined,
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    includeInactive: url.searchParams.get('includeInactive') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ items: [] }, { status: 400 })

  const query = parsed.data
  const ids = parseIds(query.ids ?? null)
  const requestedTenantId = query.tenantId ?? null
  const authTenantId = auth.tenantId ?? null
  let tenantId = enforceTenantScope(authTenantId, requestedTenantId)
  const status = query.status ?? 'all'
  const includeInactive = query.includeInactive === 'true' || status !== 'active'

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager)

  if (!tenantId && !authTenantId && ids?.length) {
    const scopedOrgs: Organization[] = await em.find(
      Organization,
      { id: { $in: ids }, deletedAt: null },
      { populate: ['tenant'] },
    )
    const tenantCandidates = new Set<string>()
    for (const org of scopedOrgs) {
      const orgTenantId = org.tenant?.id ? stringId(org.tenant.id) : ''
      if (orgTenantId) tenantCandidates.add(orgTenantId)
    }
    if (tenantCandidates.size === 1) {
      tenantId = Array.from(tenantCandidates)[0] ?? null
    } else if (tenantCandidates.size > 1) {
      return NextResponse.json({ items: [], error: 'Tenant scope required' }, { status: 400 })
    }
  }

  if (!tenantId) {
    const candidateOrgIds = new Set<string>()
    const cookieOrgId = getSelectedOrganizationFromRequest(req)
    const effectiveCookieOrgId = cookieOrgId && !isAllOrganizationsSelection(cookieOrgId) ? cookieOrgId : null
    if (effectiveCookieOrgId) candidateOrgIds.add(effectiveCookieOrgId)
    if (auth.orgId) candidateOrgIds.add(auth.orgId)

    try {
      const scope = await resolveOrganizationScopeForRequest({
        container,
        auth,
        request: req,
        selectedId: effectiveCookieOrgId ?? undefined,
      })
      if (scope.selectedId) candidateOrgIds.add(scope.selectedId)
      if (Array.isArray(scope.filterIds) && scope.filterIds.length) {
        candidateOrgIds.add(scope.filterIds[0]!)
      }
      if (Array.isArray(scope.allowedIds) && scope.allowedIds.length) {
        candidateOrgIds.add(scope.allowedIds[0]!)
      }
    } catch {}

    for (const orgId of candidateOrgIds) {
      if (!orgId) continue
      const org = await em.findOne(
        Organization,
        { id: orgId, deletedAt: null },
        { populate: ['tenant'] },
      )
      if (org?.tenant && org.tenant.id) {
        tenantId = stringId(org.tenant.id)
        break
      }
    }
  }

  if (!tenantId) {
    return NextResponse.json({ items: [], error: 'Tenant scope required' }, { status: 400 })
  }

  if (query.view === 'options') {
    const where: FilterQuery<Organization> = { tenant: tenantId, deletedAt: null }
    if (status === 'active') where.isActive = true
    if (status === 'inactive') where.isActive = false
    if (status === 'all' && !includeInactive) where.isActive = true
    if (ids) where.id = { $in: ids }
    const orgs = await em.find(Organization, where, { orderBy: { name: 'ASC' } })
    const items = orgs.map((org) => ({
      id: stringId(org.id),
      name: org.name,
      parentId: org.parentId ?? null,
      tenantId: tenantId,
      isActive: !!org.isActive,
      depth: org.depth ?? 0,
      treePath: org.treePath ?? stringId(org.id),
    }))
    await logCrudAccess({
      container,
      auth,
      request: req,
      items,
      idField: 'id',
      resourceKind: 'directory.organization',
      organizationId: null,
      tenantId,
      query,
      accessType: ids && ids.length === 1 ? 'read:item' : undefined,
    })
    return NextResponse.json({ items })
  }

  const orgListFilter: FilterQuery<Organization> = { tenant: tenantId, deletedAt: null }
  const orgs = await em.find(Organization, orgListFilter, { orderBy: { name: 'ASC' } })
  const hierarchy = computeHierarchyForOrganizations(orgs, tenantId)

  if (query.view === 'tree') {
    const nodeMap = new Map<string, { node: ComputedOrganizationNode; children: TreeNode[] }>()
    const roots: TreeNode[] = []
    for (const node of hierarchy.ordered) {
      const treeNode: TreeNode = {
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        tenantId: node.tenantId,
        depth: node.depth,
        ancestorIds: node.ancestorIds,
        childIds: node.childIds,
        descendantIds: node.descendantIds,
        isActive: node.isActive,
        treePath: node.treePath,
        pathLabel: node.pathLabel,
        children: [],
      }
      nodeMap.set(node.id, { node, children: treeNode.children })
      if (node.parentId && nodeMap.has(node.parentId)) {
        const parentEntry = nodeMap.get(node.parentId)!
        parentEntry.children.push(treeNode)
      } else {
        roots.push(treeNode)
      }
    }
    await logCrudAccess({
      container,
      auth,
      request: req,
      items: roots,
      idField: 'id',
      resourceKind: 'directory.organization',
      organizationId: null,
      tenantId,
      query,
    })
    return NextResponse.json({ items: roots })
  }

  // Manage view: paginated flat list
  const search = (query.search || '').trim().toLowerCase()
  let rows = hierarchy.ordered
  if (status === 'active') {
    rows = rows.filter((node) => node.isActive)
  } else if (status === 'inactive') {
    rows = rows.filter((node) => !node.isActive)
  }

  if (search) {
    rows = rows.filter((node) => {
      const pathLabel = (node.pathLabel || '').toLowerCase()
      return node.name.toLowerCase().includes(search) || pathLabel.includes(search)
    })
  }
  if (ids) {
    const idSet = new Set(ids)
    rows = rows.filter((node) => idSet.has(node.id))
  }

  const total = rows.length
  const pageSize = query.pageSize
  const page = query.page
  const start = (page - 1) * pageSize
  const paged = rows.slice(start, start + pageSize)
  const recordIds: string[] = []
  const tenantIdByRecord: Record<string, string | null> = {}
  const organizationIdByRecord: Record<string, string | null> = {}
  for (const node of paged) {
    const recordId = String(node.id)
    recordIds.push(recordId)
    tenantIdByRecord[recordId] = node.tenantId ? String(node.tenantId) : null
    organizationIdByRecord[recordId] = recordId
  }
  const cfByOrg = recordIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.directory.organization,
        recordIds,
        tenantIdByRecord,
        organizationIdByRecord,
        tenantFallbacks: tenantId ? [tenantId] : [],
      })
    : {}
  const items = paged.map((node) => {
    const parentName = node.parentId ? hierarchy.map.get(node.parentId)?.name ?? null : null
    const pathLabel = node.pathLabel || node.name
    const recordId = String(node.id)
    return {
      id: node.id,
      name: node.name,
      tenantId: node.tenantId,
      parentId: node.parentId,
      parentName,
      depth: node.depth,
      rootId: node.rootId,
      treePath: node.treePath,
      pathLabel,
      ancestorIds: node.ancestorIds,
      childIds: node.childIds,
      descendantIds: node.descendantIds,
      childrenCount: node.childIds.length,
      descendantsCount: node.descendantIds.length,
      isActive: node.isActive,
      ...(cfByOrg[recordId] ?? {}),
    }
  })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  await logCrudAccess({
    container,
    auth,
    request: req,
    items,
    idField: 'id',
    resourceKind: 'directory.organization',
    organizationId: null,
    tenantId,
    query,
    accessType: ids && ids.length === 1 ? 'read:item' : undefined,
  })
  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const organizationCreateResponseSchema = z.object({
  id: z.string().uuid(),
})

const organizationDeleteRequestSchema = z.object({
  id: z.string().uuid(),
})

const organizationsGetDoc: OpenApiMethodDoc = {
  summary: 'List organizations',
  description: 'Returns organizations using options, tree, or paginated manage view depending on the `view` parameter.',
  tags: [directoryTag],
  query: viewSchema,
  responses: [
    { status: 200, description: 'Organization data for the requested view.', schema: organizationListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query or tenant scope', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
  ],
}

const organizationsPostDoc: OpenApiMethodDoc = {
  summary: 'Create organization',
  description: 'Creates a new organization within a tenant and optionally assigns hierarchy relationships.',
  tags: [directoryTag],
  requestBody: {
    contentType: 'application/json',
    schema: organizationCreateSchema,
    description: 'Organization attributes and optional hierarchy configuration.',
  },
  responses: [
    { status: 201, description: 'Organization created.', schema: organizationCreateResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
    { status: 403, description: 'Missing directory.organizations.manage feature', schema: directoryErrorSchema },
  ],
}

const organizationsPutDoc: OpenApiMethodDoc = {
  summary: 'Update organization',
  description: 'Updates organization details and hierarchy assignments.',
  tags: [directoryTag],
  requestBody: {
    contentType: 'application/json',
    schema: organizationUpdateSchema,
    description: 'Organization identifier followed by fields to update.',
  },
  responses: [
    { status: 200, description: 'Organization updated.', schema: directoryOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
    { status: 403, description: 'Missing directory.organizations.manage feature', schema: directoryErrorSchema },
  ],
}

const organizationsDeleteDoc: OpenApiMethodDoc = {
  summary: 'Delete organization',
  description: 'Soft deletes an organization identified by id.',
  tags: [directoryTag],
  requestBody: {
    contentType: 'application/json',
    schema: organizationDeleteRequestSchema,
    description: 'Identifier of the organization to delete.',
  },
  responses: [
    { status: 200, description: 'Organization deleted.', schema: directoryOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
    { status: 403, description: 'Missing directory.organizations.manage feature', schema: directoryErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: directoryTag,
  summary: 'Manage organizations',
  methods: {
    GET: organizationsGetDoc,
    POST: organizationsPostDoc,
    PUT: organizationsPutDoc,
    DELETE: organizationsDeleteDoc,
  },
}
