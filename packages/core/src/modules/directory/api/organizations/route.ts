/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { OrganizationCreateInput, OrganizationUpdateInput } from '@open-mercato/core/modules/directory/data/validators'
import {
  organizationCreateSchema,
  organizationUpdateSchema,
} from '@open-mercato/core/modules/directory/data/validators'
import {
  computeHierarchyForOrganizations,
  rebuildHierarchyForTenant,
  type ComputedOrganizationNode,
} from '@open-mercato/core/modules/directory/lib/hierarchy'
import { getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadCustomFieldValues, splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'

type CrudInput = Record<string, unknown>
type CustomPayload = Record<string, unknown>

type CreateState = OrganizationCreateInput & {
  tenantId: string
  parentId: string | null
  childIds: string[]
  __custom?: CustomPayload
}

type UpdateState = OrganizationUpdateInput & {
  tenantId: string
  parentId: string | null
  childIds: string[]
  __custom?: CustomPayload
}

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

type DeleteMeta = { tenantId: string; parentId: string | null; entity: Organization }

const deleteMetaStore = new WeakMap<object, DeleteMeta>()

function resolveTenantIdFromEntity(entity: Organization): string | null {
  const cached = (entity as any)?.__tenantId
  if (cached) return String(cached)
  const tenantRef = (entity as any)?.tenant
  if (tenantRef) {
    if (typeof tenantRef === 'string') return tenantRef
    if (typeof tenantRef === 'object') {
      if (typeof tenantRef.id === 'string') return tenantRef.id
      if (tenantRef.id !== undefined && tenantRef.id !== null) return String(tenantRef.id)
      if (typeof tenantRef.getEntity === 'function') {
        const nested = tenantRef.getEntity()
        if (nested && nested.id) return String(nested.id)
      }
    }
  }
  const fallback = (entity as any)?.tenantId ?? (entity as any)?.tenant_id ?? null
  return fallback ? String(fallback) : null
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
  events: {
    module: 'directory',
    entity: 'organization',
    persistent: true,
    buildPayload: (ctx) => {
      const tenantId = resolveTenantIdFromEntity(ctx.entity)
      return {
        id: ctx.identifiers.id,
        tenantId,
        organizationId: ctx.identifiers.id,
      }
    },
  },
  indexer: {
    entityType: E.directory.organization,
    buildUpsertPayload: (ctx) => ({
      entityType: E.directory.organization,
      recordId: ctx.identifiers.id,
      organizationId: ctx.identifiers.id,
      tenantId: resolveTenantIdFromEntity(ctx.entity),
    }),
    buildDeletePayload: (ctx) => ({
      entityType: E.directory.organization,
      recordId: ctx.identifiers.id,
      organizationId: ctx.identifiers.id,
      tenantId: resolveTenantIdFromEntity(ctx.entity),
    }),
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => {
      const data = input as CreateState
      const em = ctx.container.resolve<EntityManager>('em')
      const tenantRef = em.getReference(Tenant, data.tenantId)
      return {
        tenant: tenantRef,
        name: data.name,
        isActive: data.isActive ?? true,
        parentId: data.parentId ?? null,
      }
    },
    response: (entity: Organization) => ({ id: String(entity.id) }),
  },
  update: {
    schema: rawBodySchema,
    applyToEntity: (entity: Organization, input) => {
      const data = input as UpdateState
      if (data.name !== undefined) entity.name = data.name
      if (data.isActive !== undefined) entity.isActive = data.isActive
      entity.parentId = data.parentId ?? null
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'query',
    softDelete: true,
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeCreate: async (raw, ctx) => {
      const { base, custom } = splitCustomFieldPayload(raw)
      const parsed = organizationCreateSchema.safeParse(base)
      if (!parsed.success) throw new CrudHttpError(400, { error: 'Invalid input' })

      const em = ctx.container.resolve<EntityManager>('em')
      const authTenantId = ctx.auth?.tenantId ?? null
      const tenantId = authTenantId ?? parsed.data.tenantId ?? null
      if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
      if (authTenantId && parsed.data.tenantId && parsed.data.tenantId !== authTenantId) {
        throw new CrudHttpError(403, { error: 'Forbidden' })
      }

      const parentId = parsed.data.parentId ?? null
      if (parentId) {
        const parentFilter: FilterQuery<Organization> = { id: parentId, tenant: tenantId, deletedAt: null }
        const parent = await em.findOne(Organization, parentFilter)
        if (!parent) throw new CrudHttpError(400, { error: 'Parent not found' })
      }

      const childIds = Array.from(new Set(parsed.data.childIds ?? [])).filter((id) => id !== parentId)
      if (childIds.some((id) => id === parentId)) throw new CrudHttpError(400, { error: 'Child cannot equal parent' })
      if (childIds.length) {
        const childFilter: FilterQuery<Organization> = { id: { $in: childIds }, tenant: tenantId, deletedAt: null }
        const children = await em.find(Organization, childFilter)
        if (children.length !== childIds.length) throw new CrudHttpError(400, { error: 'Invalid child assignment' })
      }

      return {
        ...parsed.data,
        tenantId,
        parentId,
        childIds,
        __custom: custom,
      } as unknown as CrudInput
    },
    afterCreate: async (entity, ctxWithInput) => {
      const input = ctxWithInput.input as CreateState
      const em = ctxWithInput.container.resolve<EntityManager>('em')
      const tenantId = input.tenantId
      ;(entity as any).__tenantId = tenantId
      const recordId = String(entity.id)
      const childIds = Array.from(new Set(input.childIds ?? [])).filter((id) => id !== recordId)
      if (childIds.length) {
        const childFilter: FilterQuery<Organization> = { tenant: tenantId, deletedAt: null, id: { $in: childIds } }
        const children = await em.find(Organization, childFilter)
        const updates = children.filter((child) => String(child.id) !== recordId && child.parentId !== recordId)
        for (const child of updates) child.parentId = recordId
        if (updates.length) await em.persistAndFlush(updates)
      }
      if (input.__custom && Object.keys(input.__custom).length) {
        const de = ctxWithInput.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.directory.organization,
          recordId,
          tenantId,
          organizationId: recordId,
          values: input.__custom,
          notify: false,
        })
      }
      await rebuildHierarchyForTenant(em, tenantId)
    },
    beforeUpdate: async (raw, ctx) => {
      const { base, custom } = splitCustomFieldPayload(raw)
      const parsed = organizationUpdateSchema.safeParse(base)
      if (!parsed.success) throw new CrudHttpError(400, { error: 'Invalid input' })

      const em = ctx.container.resolve<EntityManager>('em')
      const org = await em.findOne(Organization, { id: parsed.data.id, deletedAt: null })
      if (!org) throw new CrudHttpError(404, { error: 'Not found' })

      const authTenantId = ctx.auth?.tenantId ?? null
      const tenantId = authTenantId ?? parsed.data.tenantId ?? String(org.tenant?.id ?? '')
      if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
      if (authTenantId && tenantId !== authTenantId) throw new CrudHttpError(403, { error: 'Forbidden' })
      if (String(org.tenant?.id ?? tenantId) !== tenantId) throw new CrudHttpError(403, { error: 'Tenant mismatch' })

      const parentId = parsed.data.parentId ?? null
      if (parentId) {
        if (parentId === parsed.data.id) throw new CrudHttpError(400, { error: 'Organization cannot be its own parent' })
        if (Array.isArray(org.descendantIds) && org.descendantIds.includes(parentId)) {
          throw new CrudHttpError(400, { error: 'Cannot assign descendant as parent' })
        }
        const parentFilter: FilterQuery<Organization> = { id: parentId, tenant: tenantId, deletedAt: null }
        const parent = await em.findOne(Organization, parentFilter)
        if (!parent) throw new CrudHttpError(400, { error: 'Parent not found' })
      }

      const normalizedChildIds = Array.from(new Set(parsed.data.childIds ?? [])).filter((id) => id !== parsed.data.id && id !== parentId)
      if (normalizedChildIds.some((id) => id === parentId)) throw new CrudHttpError(400, { error: 'Child cannot equal parent' })
      if (Array.isArray(org.ancestorIds) && normalizedChildIds.some((id) => org.ancestorIds.includes(id))) {
        throw new CrudHttpError(400, { error: 'Cannot assign ancestor as child' })
      }
      if (normalizedChildIds.length) {
        const childFilter: FilterQuery<Organization> = { id: { $in: normalizedChildIds }, tenant: tenantId, deletedAt: null }
        const children = await em.find(Organization, childFilter)
        if (children.length !== normalizedChildIds.length) throw new CrudHttpError(400, { error: 'Invalid child assignment' })
        for (const child of children) {
          if (Array.isArray(child.descendantIds) && child.descendantIds.includes(parsed.data.id)) {
            throw new CrudHttpError(400, { error: 'Cannot assign descendant cycle' })
          }
        }
      }

      return {
        ...parsed.data,
        tenantId,
        parentId,
        childIds: normalizedChildIds,
        __custom: custom,
      } as unknown as CrudInput
    },
    afterUpdate: async (entity, ctxWithInput) => {
      const input = ctxWithInput.input as UpdateState
      const em = ctxWithInput.container.resolve<EntityManager>('em')
      const tenantId = input.tenantId
      ;(entity as any).__tenantId = tenantId
      const recordId = String(entity.id)

      const desiredChildIds = new Set((input.childIds ?? []).filter((id) => id !== recordId))
      const toPersist: Organization[] = []

      const currentChildrenFilter: FilterQuery<Organization> = { tenant: tenantId, parentId: recordId, deletedAt: null }
      const currentChildren = await em.find(Organization, currentChildrenFilter)
      for (const child of currentChildren) {
        if (!desiredChildIds.has(String(child.id))) {
          child.parentId = null
          toPersist.push(child)
        }
      }

      if (desiredChildIds.size > 0) {
        const targetChildrenFilter: FilterQuery<Organization> = {
          tenant: tenantId,
          deletedAt: null,
          id: { $in: Array.from(desiredChildIds) },
        }
        const targetChildren = await em.find(Organization, targetChildrenFilter)
        for (const child of targetChildren) {
          if (String(child.id) === recordId) continue
          if (child.parentId !== recordId) {
            child.parentId = recordId
            toPersist.push(child)
          }
        }
      }

      if (toPersist.length) await em.persistAndFlush(toPersist)

      if (input.__custom && Object.keys(input.__custom).length) {
        const de = ctxWithInput.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.directory.organization,
          recordId,
          tenantId,
          organizationId: recordId,
          values: input.__custom,
          notify: false,
        })
      }

      await rebuildHierarchyForTenant(em, tenantId)
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const orgFilter: FilterQuery<Organization> = { id, deletedAt: null }
      const org = await em.findOne(Organization, orgFilter)
      if (!org) throw new CrudHttpError(404, { error: 'Not found' })

      const authTenantId = ctx.auth?.tenantId ?? null
      const tenantId = authTenantId ?? String(org.tenant?.id ?? '')
      if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
      if (authTenantId && tenantId !== authTenantId) throw new CrudHttpError(403, { error: 'Forbidden' })

      ;(org as any).__tenantId = tenantId

      deleteMetaStore.set(ctx, {
        tenantId,
        parentId: org.parentId ?? null,
        entity: org,
      })
    },
    afterDelete: async (id, ctx) => {
      const meta = deleteMetaStore.get(ctx)
      if (!meta) return

      const em = ctx.container.resolve<EntityManager>('em')
      const childrenFilter: FilterQuery<Organization> = { tenant: meta.tenantId, parentId: id, deletedAt: null }
      const children = await em.find(Organization, childrenFilter)

      const toPersist: Organization[] = []
      for (const child of children) {
        child.parentId = meta.parentId
        toPersist.push(child)
      }
      meta.entity.isActive = false
      meta.entity.parentId = null
      toPersist.push(meta.entity)
      if (toPersist.length) await em.persistAndFlush(toPersist)

      await rebuildHierarchyForTenant(em, meta.tenantId)
      deleteMetaStore.delete(ctx)
    },
  },
})

export const metadata = crud.metadata

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
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

  const { resolve } = await createRequestContainer()
  const em = resolve<EntityManager>('em')

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
    const selectedOrgId = getSelectedOrganizationFromRequest(req)
    if (selectedOrgId) {
      const selectedOrg = await em.findOne(
        Organization,
        { id: selectedOrgId, deletedAt: null },
        { populate: ['tenant'] },
      )
      if (selectedOrg?.tenant && selectedOrg.tenant.id) {
        tenantId = stringId(selectedOrg.tenant.id)
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
  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
