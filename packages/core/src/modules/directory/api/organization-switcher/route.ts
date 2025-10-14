import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { computeHierarchyForOrganizations, type ComputedHierarchy } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

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
  if (!auth || !auth.tenantId || !auth.sub) {
    return NextResponse.json({ items: [], selectedId: null, canManage: false }, { status: auth ? 200 : 401 })
  }

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as any

    const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId ?? null })
    const hasManageFeature =
      acl.isSuperAdmin ||
      await rbac.userHasAllFeatures(auth.sub, ['directory.organizations.manage'], {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
      })

    const orgEntities: Organization[] = await em.find(
      Organization,
      { tenant: auth.tenantId as any, deletedAt: null },
      { orderBy: { name: 'ASC' } },
    )
    const hierarchy = computeHierarchyForOrganizations(orgEntities, auth.tenantId)
    const accessible = Array.isArray(acl.organizations) ? acl.organizations : null
    const menuData = buildOrganizationMenu(hierarchy, accessible)

    let selectedId = getSelectedOrganizationFromRequest(req) ?? null
    if (selectedId && !menuData.selectableIds.has(selectedId) && accessible !== null) {
      selectedId = null
    }
    if (!selectedId && auth.orgId) {
      if (accessible === null || menuData.selectableIds.has(auth.orgId)) {
        selectedId = auth.orgId
      }
    }

    const showMenu = menuData.nodes.length > 0 || hasManageFeature || acl.isSuperAdmin
    if (!showMenu) {
      return NextResponse.json({ items: [], selectedId: null, canManage: false })
    }

    return NextResponse.json({
      items: menuData.nodes,
      selectedId,
      canManage: !!hasManageFeature,
    })
  } catch (err) {
    console.error('Failed to build organization switcher payload', err)
    return NextResponse.json({ items: [], selectedId: null, canManage: false }, { status: 500 })
  }
}
