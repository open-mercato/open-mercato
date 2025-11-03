import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { computeHierarchyForOrganizations, type ComputedHierarchy } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import {
  getSelectedOrganizationFromRequest,
  getSelectedTenantFromRequest,
  resolveOrganizationScope,
} from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { directoryTag, directoryErrorSchema, organizationSwitcherResponseSchema } from '../openapi'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { FilterQuery } from '@mikro-orm/core'

type OrganizationMenuNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children: OrganizationMenuNode[]
}

function buildOrganizationMenu(
  hierarchy: ComputedHierarchy,
  accessible: string[] | null,
): { nodes: OrganizationMenuNode[]; selectableIds: Set<string> } {
  const roots: OrganizationMenuNode[] = []
  const selectableIds = new Set<string>()
  if (!hierarchy.ordered.length) return { nodes: roots, selectableIds }

  const includeSet = new Set<string>()
  if (accessible === null) {
    for (const node of hierarchy.ordered) {
      includeSet.add(node.id)
      selectableIds.add(node.id)
    }
  } else {
    const accessibleSet = new Set(accessible)
    for (const id of accessibleSet) {
      const node = hierarchy.map.get(id)
      if (!node) continue
      includeSet.add(id)
      selectableIds.add(id)
      for (const desc of node.descendantIds) {
        includeSet.add(desc)
        selectableIds.add(desc)
      }
      for (const anc of node.ancestorIds) includeSet.add(anc)
    }
  }

  const menuNodes = new Map<string, OrganizationMenuNode>()
  for (const node of hierarchy.ordered) {
    if (!includeSet.has(node.id)) continue
    const menuNode: OrganizationMenuNode = {
      id: node.id,
      name: node.name,
      depth: node.depth,
      selectable: accessible === null ? true : selectableIds.has(node.id),
      children: [],
    }
    menuNodes.set(node.id, menuNode)
  }

  const ensureChild = (parent: OrganizationMenuNode, child: OrganizationMenuNode) => {
    if (!parent.children.some((existing) => existing.id === child.id)) parent.children.push(child)
  }

  for (const node of hierarchy.ordered) {
    if (!includeSet.has(node.id)) continue
    const menuNode = menuNodes.get(node.id)!
    const parentId = node.parentId
    if (parentId && menuNodes.has(parentId)) {
      ensureChild(menuNodes.get(parentId)!, menuNode)
    } else if (!roots.some((existing) => existing.id === menuNode.id)) {
      roots.push(menuNode)
    }
  }

  return { nodes: roots, selectableIds }
}

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.sub) {
    return NextResponse.json({ items: [], selectedId: null, canManage: false, tenantId: null, tenants: [], isSuperAdmin: false }, { status: auth ? 200 : 401 })
  }

  const url = new URL(req.url)

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const rbac = container.resolve<RbacService>('rbacService')

    const rawTenantParam = url.searchParams.get('tenantId')
    const cookieTenant = getSelectedTenantFromRequest(req)
    const actorTenantId = typeof auth.tenantId === 'string' && auth.tenantId.trim().length > 0 ? auth.tenantId.trim() : null
    const actorIsSuperAdmin = auth.isSuperAdmin === true

    let requestedTenantId = rawTenantParam ?? (cookieTenant ?? undefined)
    if (requestedTenantId === '') requestedTenantId = undefined
    let tenantId = typeof requestedTenantId === 'string' && requestedTenantId.trim().length > 0 ? requestedTenantId.trim() : null

    let tenantRecords: { id: string; name: string; isActive: boolean }[] = []
    if (actorIsSuperAdmin) {
      const tenants = await em.find(Tenant, { deletedAt: null }, { orderBy: { name: 'ASC' } })
      tenantRecords = tenants.map((tenant: Tenant) => ({
        id: String(tenant.id),
        name: typeof tenant.name === 'string' && tenant.name.length > 0 ? tenant.name : String(tenant.id),
        isActive: tenant.isActive !== false,
      }))
      if (!tenantId) tenantId = actorTenantId ?? (tenantRecords[0]?.id ?? null)
      if (tenantId && tenantRecords.length && !tenantRecords.some((record) => record.id === tenantId)) {
        tenantId = tenantRecords[0]?.id ?? tenantId
      }
    } else {
      tenantId = actorTenantId
    }

    if (!tenantId) {
      return NextResponse.json({
        items: [],
        selectedId: null,
        canManage: false,
        tenantId: null,
        tenants: tenantRecords,
        isSuperAdmin: actorIsSuperAdmin,
      })
    }

    const scopedOrgId = actorTenantId && actorTenantId === tenantId ? auth.orgId ?? null : null
    const acl = await rbac.loadAcl(auth.sub, { tenantId, organizationId: scopedOrgId })
    const aclIsSuperAdmin = acl?.isSuperAdmin === true
    const effectiveIsSuperAdmin = actorIsSuperAdmin || aclIsSuperAdmin
    const hasManageFeature =
      aclIsSuperAdmin ||
      await rbac.userHasAllFeatures(auth.sub, ['directory.organizations.manage'], {
        tenantId,
        organizationId: scopedOrgId,
      }) ||
      actorIsSuperAdmin

    const orgFilter: FilterQuery<Organization> = {
      tenant: tenantId,
      deletedAt: null,
    }
    const orgEntities: Organization[] = await em.find(
      Organization,
      orgFilter,
      { orderBy: { name: 'ASC' } },
    )
    const hierarchy = computeHierarchyForOrganizations(orgEntities, tenantId)
    const rawSelected = getSelectedOrganizationFromRequest(req)
    let hasSelectionCookie = rawSelected !== null
    const requestedAll = isAllOrganizationsSelection(rawSelected)
    const scope = await resolveOrganizationScope({
      em,
      rbac,
      auth: {
        ...auth,
        tenantId,
        orgId: scopedOrgId,
      },
      selectedId: requestedAll ? null : rawSelected,
      tenantId,
    })
    const accessible = scope.allowedIds
    const menuData = buildOrganizationMenu(hierarchy, accessible)

    let selectedId = requestedAll ? null : (scope.selectedId ?? null)
    if (selectedId && !menuData.selectableIds.has(selectedId)) {
      selectedId = null
      if (!requestedAll) {
        hasSelectionCookie = false
      }
    }
    if (!selectedId && !hasSelectionCookie && auth.orgId) {
      if (accessible === null || menuData.selectableIds.has(auth.orgId)) {
        selectedId = auth.orgId
      }
    }

    const showMenu = menuData.nodes.length > 0 || hasManageFeature || effectiveIsSuperAdmin
    if (!showMenu) {
      return NextResponse.json({ items: [], selectedId: null, canManage: false })
    }

    const response = {
      items: menuData.nodes,
      selectedId,
      canManage: !!hasManageFeature,
      tenantId,
      tenants: tenantRecords,
      isSuperAdmin: effectiveIsSuperAdmin,
    }

    await logCrudAccess({
      container,
      auth,
      request: req,
      items: response.items,
      idField: 'id',
      resourceKind: 'directory.organization_switcher',
      organizationId: response.selectedId,
      tenantId,
      query: Object.fromEntries(url.searchParams.entries()),
    })

    return NextResponse.json(response)
  } catch (err) {
    console.error('Failed to build organization switcher payload', err)
    return NextResponse.json({ items: [], selectedId: null, canManage: false, tenantId: null, tenants: [], isSuperAdmin: false }, { status: 500 })
  }
}

const organizationSwitcherGetDoc: OpenApiMethodDoc = {
  summary: 'Load organization switcher menu',
  description: 'Returns the hierarchical menu of organizations the current user may switch to within the active tenant.',
  tags: [directoryTag],
  responses: [
    { status: 200, description: 'Organization switcher payload.', schema: organizationSwitcherResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: directoryTag,
  summary: 'Organization switcher menu',
  methods: {
    GET: organizationSwitcherGetDoc,
  },
}
