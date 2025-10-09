import { modules } from '@/generated/modules.generated'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'
import { AppShell } from '@open-mercato/ui/backend/AppShell'
import { buildAdminNav } from '@open-mercato/ui/backend/utils/nav'
import { UserMenu } from '@open-mercato/ui/backend/UserMenu'
import { createRequestContainer } from '@/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { computeHierarchyForOrganizations, type ComputedHierarchy } from '@open-mercato/core/modules/directory/lib/hierarchy'
import OrganizationSwitcher from '@/components/OrganizationSwitcher'

type OrganizationMenuNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  path: string[]
  children: OrganizationMenuNode[]
}

function buildOrganizationMenu(
  hierarchy: ComputedHierarchy,
  accessible: string[] | null
): { nodes: OrganizationMenuNode[]; selectableIds: Set<string> } {
  const roots: OrganizationMenuNode[] = []
  const selectableIds = new Set<string>()
  if (!hierarchy.ordered.length) return { nodes: roots, selectableIds }

  // Determine which nodes to include and which are selectable
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
  const buildPath = (nodeId: string): string[] => {
    const computed = hierarchy.map.get(nodeId)
    if (!computed) return []
    const pathParts = computed.ancestorIds
      .map((id) => hierarchy.map.get(id)?.name)
      .filter((name): name is string => !!name)
    pathParts.push(computed.name)
    return pathParts
  }

  for (const node of hierarchy.ordered) {
    if (!includeSet.has(node.id)) continue
    const menuNode: OrganizationMenuNode = {
      id: node.id,
      name: node.name,
      depth: node.depth,
      selectable: accessible === null ? true : selectableIds.has(node.id),
      path: buildPath(node.id),
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

export default async function BackendLayout({ children, params }: { children: React.ReactNode; params?: { slug?: string[] } }) {
  const auth = await getAuthFromCookies()
  let cookieStore: any = null
  try {
    const { cookies } = await import('next/headers')
    cookieStore = await cookies()
  } catch {}

  // Prefer pathname injected by middleware; fallback to params-based path
  let path = ''
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    path = h.get('x-next-url') || ''
  } catch {}
  // Ensure we pass only a pathname
  if (path.includes('?')) path = path.split('?')[0]
  if (!path) {
    const slug = params?.slug ?? []
    path = '/backend' + (Array.isArray(slug) && slug.length ? '/' + slug.join('/') : '')
  }

  const ctxAuth = auth ? { 
    roles: auth.roles || [], 
    sub: auth.sub, 
    tenantId: auth.tenantId, 
    orgId: auth.orgId 
  } : undefined
  const ctx = { auth: ctxAuth, path }
  
  // Build initial nav (SSR) using module metadata to preserve icons
  const entries = await buildAdminNav(modules as any[], ctx)
  const groupMap = new Map<string, {
    name: string,
    items: { href: string; title: string; enabled?: boolean; icon?: React.ReactNode; children?: { href: string; title: string; enabled?: boolean; icon?: React.ReactNode }[] }[],
    weight: number,
  }>()
  for (const e of entries) {
    const w = (e.priority ?? e.order ?? 10_000)
    if (!groupMap.has(e.group)) {
      groupMap.set(e.group, { name: e.group, items: [], weight: w })
    } else {
      const g = groupMap.get(e.group)!
      if (w < g.weight) g.weight = w
    }
    const g = groupMap.get(e.group)!
    g.items.push({
      href: e.href,
      title: e.title,
      enabled: e.enabled,
      icon: e.icon,
      children: (e.children || []).map((c) => ({ href: c.href, title: c.title, enabled: c.enabled, icon: c.icon })),
    })
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.weight - b.weight)

  let organizationSwitcher: React.ReactNode = null
  if (auth?.tenantId && auth?.sub) {
    try {
      const { resolve } = await createRequestContainer()
      const em = resolve('em') as any
      const rbac = resolve('rbacService') as any
      const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId ?? null })
      const hasManageFeature = acl.isSuperAdmin ||
        await rbac.userHasAllFeatures(auth.sub, ['directory.organizations.manage'], { tenantId: auth.tenantId, organizationId: auth.orgId ?? null })

      const orgEntities: Organization[] = await em.find(Organization, { tenant: auth.tenantId as any, deletedAt: null }, { orderBy: { name: 'ASC' } })
      const hierarchy = computeHierarchyForOrganizations(orgEntities, auth.tenantId)
      const menuData = buildOrganizationMenu(hierarchy, Array.isArray(acl.organizations) ? acl.organizations : null)
      let selectedFromCookie = cookieStore?.get('om_selected_org')?.value ?? null
      if (selectedFromCookie && !menuData.selectableIds.has(selectedFromCookie) && acl.organizations !== null) {
        selectedFromCookie = null
      }
      let initialSelected = selectedFromCookie
      if (!initialSelected && auth.orgId) {
        if (acl.organizations === null || menuData.selectableIds.has(auth.orgId)) {
          initialSelected = auth.orgId
        }
      }
      const showMenu = menuData.nodes.length > 0 || hasManageFeature || acl.isSuperAdmin
      if (showMenu) {
        organizationSwitcher = (
          <OrganizationSwitcher
            items={menuData.nodes}
            selectedId={initialSelected ?? null}
            canManage={!!hasManageFeature}
          />
        )
      }
    } catch (err) {
      console.error('Failed to build organization switcher', err)
    }
  }

  // Derive current title from path and fetched groups
  const allEntries: Array<{ href: string; title: string; group: string; children?: any[] }> = groups.flatMap((g) => g.items.map((i: any) => ({ ...i, group: g.name })))
  const current = allEntries.find((i) => path.startsWith(i.href))
  const currentTitle = current?.title || ''
  const match = findBackendMatch(modules as any[], path)
  const breadcrumb = (match?.route as any)?.breadcrumb as Array<{ label: string; href?: string }> | undefined
  // Read collapsed state from cookie for SSR-perfect initial render
  let initialCollapsed = false
  if (cookieStore) {
    const v = cookieStore.get('om_sidebar_collapsed')?.value
    initialCollapsed = v === '1'
  }

  const rightHeaderContent = (
    <div className="flex items-center gap-3">
      {organizationSwitcher}
      <UserMenu email={auth?.email} />
    </div>
  )

  return (
    <AppShell key={path} productName="Open Mercato" email={auth?.email} groups={groups} currentTitle={currentTitle} breadcrumb={breadcrumb} sidebarCollapsedDefault={initialCollapsed} rightHeaderSlot={rightHeaderContent} adminNavApi="/api/auth/admin/nav"> 
      {children}
    </AppShell>
  )
}
export const dynamic = 'force-dynamic'
