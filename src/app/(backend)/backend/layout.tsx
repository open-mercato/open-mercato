import { modules } from '@/generated/modules.generated'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'
import { AppShell } from '@open-mercato/ui/backend/AppShell'
import { buildAdminNav } from '@open-mercato/ui/backend/utils/nav'
import type { AdminNavItem } from '@open-mercato/ui/backend/utils/nav'
import { UserMenu } from '@open-mercato/ui/backend/UserMenu'
import { VectorSearchDialog } from '@open-mercato/vector/modules/vector/frontend'
import OrganizationSwitcher from '@/components/OrganizationSwitcher'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@/lib/di/container'
import { applySidebarPreference, loadFirstRoleSidebarPreference, loadSidebarPreference } from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'

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
  const { translate, locale } = await resolveTranslations()
  const vectorApiKeyAvailable = Boolean(process.env.OPENAI_API_KEY)
  const vectorMissingKeyMessage = translate('vector.messages.missingKey', 'Vector search requires configuring OPENAI_API_KEY.')
  const entries = await buildAdminNav(
    modules as any[],
    ctx,
    undefined,
    (key, fallback) => (key ? translate(key, fallback) : fallback),
  )
  const groupMap = new Map<string, {
    id: string,
    key?: string,
    name: string,
    defaultName: string,
    items: AdminNavItem[],
    weight: number,
  }>()
  for (const entry of entries) {
    const weight = entry.priority ?? entry.order ?? 10_000
    if (!groupMap.has(entry.groupId)) {
      groupMap.set(entry.groupId, {
        id: entry.groupId,
        key: entry.groupKey,
        name: entry.group,
        defaultName: entry.groupDefaultName,
        items: [entry],
        weight,
      })
    } else {
      const group = groupMap.get(entry.groupId)!
      group.items.push(entry)
      if (weight < group.weight) group.weight = weight
      if (!group.key && entry.groupKey) group.key = entry.groupKey
    }
  }

  const mapItem = (item: AdminNavItem) => ({
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    enabled: item.enabled,
    hidden: item.hidden,
    icon: item.icon,
    children: item.children?.map(mapItem),
  })

  const baseGroups = Array.from(groupMap.values()).map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    weight: group.weight,
    items: group.items.map((item) => mapItem(item)),
  }))
  baseGroups.sort((a, b) => a.weight - b.weight)

  let rolePreference = null
  let sidebarPreference = null
  if (auth) {
    try {
      const container = await createRequestContainer()
      const em = container.resolve('em') as any
      if (Array.isArray(auth.roles) && auth.roles.length) {
        const roleScope = auth.tenantId
          ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
          : { tenantId: null }
        const roleRecords = await em.find(Role, {
          name: { $in: auth.roles },
          ...roleScope,
        } as any)
        const roleIds = roleRecords.map((role: Role) => role.id)
        if (roleIds.length) {
          rolePreference = await loadFirstRoleSidebarPreference(em, {
            roleIds,
            tenantId: auth.tenantId ?? null,
            locale,
          })
        }
      }
      sidebarPreference = await loadSidebarPreference(em, {
        userId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        locale,
      })
    } catch {}
  }

  const groupsWithRole = rolePreference ? applySidebarPreference(baseGroups, rolePreference) : baseGroups
  const baseForUser = adoptSidebarDefaults(groupsWithRole)
  const appliedGroups = sidebarPreference ? applySidebarPreference(baseForUser, sidebarPreference) : baseForUser

  const materializeItem = (item: ReturnType<typeof mapItem>) => ({
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    enabled: item.enabled,
    hidden: item.hidden,
    icon: item.icon,
    children: item.children?.map(materializeItem),
  })

  const groups = appliedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    items: group.items.map((item) => materializeItem(item)),
    weight: group.weight,
  }))

  // Derive current title from path and fetched groups
  const allEntries: Array<{ href: string; title: string; group: string; children?: any[] }> = groups.flatMap((g) => g.items.map((i: any) => ({ ...i, group: g.name })))
  const current = allEntries.find((i) => path.startsWith(i.href))
  const currentTitle = current?.title || ''
  const match = findBackendMatch(modules as any[], path)
  const rawBreadcrumb = (match?.route as any)?.breadcrumb as Array<{ label?: string; labelKey?: string; href?: string }> | undefined
  const breadcrumb = rawBreadcrumb?.map((item) => {
    const fallback = typeof item.label === 'string' ? item.label : ''
    const label = item.labelKey ? translate(item.labelKey, fallback || item.labelKey) : fallback
    return { ...item, label }
  })
  // Read collapsed state from cookie for SSR-perfect initial render
  let initialCollapsed = false
  if (cookieStore) {
    const v = cookieStore.get('om_sidebar_collapsed')?.value
    initialCollapsed = v === '1'
  }

  const rightHeaderContent = (
    <>
      <VectorSearchDialog apiKeyAvailable={vectorApiKeyAvailable} missingKeyMessage={vectorMissingKeyMessage} />
      <OrganizationSwitcher />
      <UserMenu email={auth?.email} />
    </>
  )

  const productName = translate('appShell.productName', 'Open Mercato')

  return (
    <AppShell key={path} productName={productName} email={auth?.email} groups={groups} currentTitle={currentTitle} breadcrumb={breadcrumb} sidebarCollapsedDefault={initialCollapsed} rightHeaderSlot={rightHeaderContent} adminNavApi="/api/auth/admin/nav"> 
      {children}
    </AppShell>
  )
}
export const dynamic = 'force-dynamic'

function adoptSidebarDefaults(groups: ReturnType<typeof applySidebarPreference>) {
  const adoptItems = (items: any[]) =>
    items.map((item) => ({
      ...item,
      defaultTitle: item.title,
      children: item.children ? adoptItems(item.children) : undefined,
    }))

  return groups.map((group) => ({
    ...group,
    defaultName: group.name,
    items: adoptItems(group.items),
  }))
}
