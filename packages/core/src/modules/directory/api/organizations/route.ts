import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  organizationCreateSchema,
  organizationUpdateSchema,
} from '@open-mercato/core/modules/directory/data/validators'
import {
  computeHierarchyForOrganizations,
  rebuildHierarchyForTenant,
  type ComputedOrganizationNode,
} from '@open-mercato/core/modules/directory/lib/hierarchy'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'

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

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['directory.organizations.view'] },
  POST: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
}

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
  const em = resolve('em') as any
  const de = resolve('dataEngine') as DataEngine
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }
  const de = resolve('dataEngine') as DataEngine
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }

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
    return NextResponse.json({ items: [], error: 'Tenant scope required' }, { status: 400 })
  }

  if (query.view === 'options') {
    const where: any = { tenant: tenantId as any, deletedAt: null }
    if (status === 'active') where.isActive = true
    if (status === 'inactive') where.isActive = false
    if (status === 'all' && !includeInactive) where.isActive = true
    if (ids) where.id = { $in: ids }
    const orgs: Organization[] = await em.find(Organization, where, { orderBy: { name: 'ASC' } })
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

  const orgs: Organization[] = await em.find(
    Organization,
    { tenant: tenantId as any, deletedAt: null },
    { orderBy: { name: 'ASC' } },
  )
  const hierarchy = computeHierarchyForOrganizations(orgs, tenantId)

  if (query.view === 'tree') {
    const nodeMap = new Map<string, { node: ComputedOrganizationNode; children: any[] }>()
    const roots: any[] = []
    for (const node of hierarchy.ordered) {
      const treeNode = {
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
        children: [] as any[],
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
  const items = paged.map((node) => {
    const parentName = node.parentId ? hierarchy.map.get(node.parentId)?.name ?? null : null
    const pathLabel = node.pathLabel || node.name
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
    }
  })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rawBody = await req.json().catch(() => ({}))
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = organizationCreateSchema.safeParse(base)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const tenantId = auth.tenantId ?? parsed.data.tenantId ?? null
  if (!tenantId) return NextResponse.json({ error: 'Tenant scope required' }, { status: 400 })
  if (auth.tenantId && tenantId !== auth.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const parentId = parsed.data.parentId ?? null
  const childIds = Array.from(new Set(parsed.data.childIds ?? [])).filter((id) => id !== parentId)

  if (parentId === null) {
    // ok
  } else {
    const parent = await em.findOne(Organization, { id: parentId, tenant: tenantId as any, deletedAt: null })
    if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 400 })
  }

  if (childIds.length) {
    if (childIds.includes(parentId || '')) {
      return NextResponse.json({ error: 'Child cannot equal parent' }, { status: 400 })
    }
  }

  const id = randomUUID()
  const tenantRef = em.getReference(Tenant, tenantId)
  const org = em.create(Organization, {
    id,
    tenant: tenantRef,
    name: parsed.data.name,
    isActive: parsed.data.isActive ?? true,
    parentId: parentId,
  })
  em.persist(org)

  if (childIds.length) {
    const children = await em.find(Organization, {
      tenant: tenantId as any,
      deletedAt: null,
      id: { $in: childIds },
    })
    if (children.length !== childIds.length) {
      return NextResponse.json({ error: 'Invalid child assignment' }, { status: 400 })
    }
    for (const child of children) {
      if (String(child.id) === id) {
        return NextResponse.json({ error: 'Organization cannot be its own child' }, { status: 400 })
      }
      child.parentId = id
    }
  }

  await em.flush()
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.directory.organization,
      recordId: id,
      tenantId,
      organizationId: id,
      values: custom,
      notify: false,
    })
  }
  await rebuildHierarchyForTenant(em, tenantId)
  if (bus) {
    try {
      await bus.emitEvent('directory.organization.created', { id, tenantId, organizationId: id }, { persistent: true })
      await bus.emitEvent('query_index.upsert_one', { entityType: E.directory.organization, recordId: id, organizationId: id, tenantId })
    } catch {}
  }
  return NextResponse.json({ id })
}

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rawBody = await req.json().catch(() => ({}))
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = organizationUpdateSchema.safeParse(base)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const de = resolve('dataEngine') as DataEngine
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }
  const org = await em.findOne(Organization, { id: parsed.data.id, deletedAt: null })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tenantId = auth.tenantId ?? parsed.data.tenantId ?? String(org.tenant?.id || '')
  if (!tenantId) return NextResponse.json({ error: 'Tenant scope required' }, { status: 400 })
  if (auth.tenantId && tenantId !== auth.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (String(org.tenant?.id || tenantId) !== tenantId) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 })
  }

  const parentId = parsed.data.parentId ?? null
  if (parentId) {
    if (parentId === String(org.id)) {
      return NextResponse.json({ error: 'Organization cannot be its own parent' }, { status: 400 })
    }
    if (Array.isArray(org.descendantIds) && org.descendantIds.includes(parentId)) {
      return NextResponse.json({ error: 'Cannot assign descendant as parent' }, { status: 400 })
    }
    const parent = await em.findOne(Organization, { id: parentId, tenant: tenantId as any, deletedAt: null })
    if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 400 })
  }

  const childIds = Array.from(new Set(parsed.data.childIds ?? [])).filter((id) => id !== String(org.id))
  if (childIds.some((id) => id === parentId)) {
    return NextResponse.json({ error: 'Child cannot equal parent' }, { status: 400 })
  }
  if (Array.isArray(org.ancestorIds) && childIds.some((id) => org.ancestorIds.includes(id))) {
    return NextResponse.json({ error: 'Cannot assign ancestor as child' }, { status: 400 })
  }

  if (parsed.data.name !== undefined) org.name = parsed.data.name
  if (parsed.data.isActive !== undefined) org.isActive = parsed.data.isActive
  org.parentId = parentId

  // Update direct children assignments
  const desiredChildSet = new Set(childIds)

  const currentChildren = await em.find(Organization, {
    tenant: tenantId as any,
    parentId: org.id,
    deletedAt: null,
  })
  for (const child of currentChildren) {
    if (!desiredChildSet.has(String(child.id))) {
      child.parentId = null
    }
  }

  if (desiredChildSet.size > 0) {
    const desiredChildIds = Array.from(desiredChildSet)
    const targetChildren = await em.find(Organization, {
      tenant: tenantId as any,
      deletedAt: null,
      id: { $in: desiredChildIds },
    })
    if (targetChildren.length !== desiredChildIds.length) {
      return NextResponse.json({ error: 'Invalid child assignment' }, { status: 400 })
    }
    for (const child of targetChildren) {
      if (Array.isArray(child.descendantIds) && child.descendantIds.includes(String(org.id))) {
        return NextResponse.json({ error: 'Cannot assign descendant cycle' }, { status: 400 })
      }
      child.parentId = String(org.id)
    }
  }

  await em.flush()
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.directory.organization,
      recordId: String(org.id),
      tenantId,
      organizationId: String(org.id),
      values: custom,
      notify: false,
    })
  }
  await rebuildHierarchyForTenant(em, tenantId)
  if (bus) {
    try {
      await bus.emitEvent('directory.organization.updated', { id: String(org.id), tenantId, organizationId: String(org.id) }, { persistent: true })
      await bus.emitEvent('query_index.upsert_one', { entityType: E.directory.organization, recordId: String(org.id), organizationId: String(org.id), tenantId })
    } catch {}
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const org = await em.findOne(Organization, { id, deletedAt: null })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tenantId = auth.tenantId ?? String(org.tenant?.id || '')
  if (!tenantId) return NextResponse.json({ error: 'Tenant scope required' }, { status: 400 })
  if (auth.tenantId && tenantId !== auth.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parentId = org.parentId ?? null
  const children = await em.find(Organization, {
    tenant: tenantId as any,
    parentId: org.id,
    deletedAt: null,
  })
  for (const child of children) {
    child.parentId = parentId
  }

  org.deletedAt = new Date()
  org.isActive = false
  org.parentId = null
  await em.flush()
  await rebuildHierarchyForTenant(em, tenantId)
  try {
    const bus = resolve('eventBus') as any
    await bus.emitEvent('directory.organization.deleted', { id: String(org.id), tenantId, organizationId: String(org.id) }, { persistent: true })
    await bus.emitEvent('query_index.delete_one', { entityType: E.directory.organization, recordId: String(org.id), organizationId: String(org.id) })
  } catch {}
  return NextResponse.json({ ok: true })
}
