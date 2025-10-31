import type { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
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
import {
  applySidebarPreference,
  loadFirstRoleSidebarPreference,
  loadSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import type { SidebarPreferencesSettings } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'

type NavItem = {
  href: string
  title: string
  defaultTitle: string
  enabled: boolean
  hidden?: boolean
  icon?: ReactNode
  children?: NavItem[]
}

type NavGroup = {
  id: string
  name: string
  defaultName: string
  items: NavItem[]
  weight: number
}

export default async function BackendLayout({ children, params }: { children: React.ReactNode; params?: { slug?: string[] } }) {
  const auth = await getAuthFromCookies()
  const cookieStore = cookies()
  const headerStore = headers()
  let path = headerStore.get('x-next-url') ?? ''
  if (path.includes('?')) path = path.split('?')[0]
  if (!path) {
    const slug = params?.slug ?? []
    path = '/backend' + (Array.isArray(slug) && slug.length ? '/' + slug.join('/') : '')
  }

  const ctxAuth = auth
    ? {
        roles: auth.roles || [],
        sub: auth.sub,
        tenantId: auth.tenantId,
        orgId: auth.orgId,
      }
    : undefined
  const ctx = { auth: ctxAuth, path }

  const { translate, locale } = await resolveTranslations()
  const vectorApiKeyAvailable = Boolean(process.env.OPENAI_API_KEY)
  const vectorMissingKeyMessage = translate('vector.messages.missingKey', 'Vector search requires configuring OPENAI_API_KEY.')
  const entries = await buildAdminNav(
    modules,
    ctx,
    undefined,
    (key, fallback) => (key ? translate(key, fallback) : fallback),
  )

  const groupMap = new Map<string, {
    id: string
    key?: string
    name: string
    defaultName: string
    items: AdminNavItem[]
    weight: number
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

  const mapItem = (item: AdminNavItem): NavItem => ({
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    enabled: item.enabled,
    hidden: item.hidden,
    icon: item.icon,
    children: item.children?.map(mapItem),
  })

  const baseGroups: NavGroup[] = Array.from(groupMap.values()).map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    weight: group.weight,
    items: group.items.map(mapItem),
  }))
  baseGroups.sort((a, b) => a.weight - b.weight)

  let rolePreference: SidebarPreferencesSettings | null = null
  let sidebarPreference: SidebarPreferencesSettings | null = null
  if (auth) {
    try {
      const container = await createRequestContainer()
      const em = container.resolve<EntityManager>('em')
      if (Array.isArray(auth.roles) && auth.roles.length) {
        const roleScope: FilterQuery<Role> = auth.tenantId
          ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
          : { tenantId: null }
        const roleRecords = await em.find(Role, {
          name: { $in: auth.roles },
          ...roleScope,
        })
        const roleIds = roleRecords.map((role) => role.id)
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
    } catch {
      // ignore preference loading failures; render with default navigation
    }
  }

  const groupsWithRole = rolePreference ? applySidebarPreference(baseGroups, rolePreference) : baseGroups
  const baseForUser = adoptSidebarDefaults(groupsWithRole)
  const appliedGroups = sidebarPreference ? applySidebarPreference(baseForUser, sidebarPreference) : baseForUser

  const materializeItem = (item: NavItem): NavItem => ({
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    enabled: item.enabled,
    hidden: item.hidden,
    icon: item.icon,
    children: item.children?.map(materializeItem),
  })

  const groups: NavGroup[] = appliedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    items: group.items.map(materializeItem),
    weight: group.weight,
  }))

  type NavEntry = NavItem & { group: string }
  const allEntries: NavEntry[] = groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.name })),
  )
  const current = allEntries.find((item) => path.startsWith(item.href))
  const currentTitle = current?.title || ''
  const match = findBackendMatch(modules, path)
  const rawBreadcrumb = match?.route.breadcrumb
  const breadcrumb = rawBreadcrumb?.map((item) => {
    const fallback = item.label
    const label = item.labelKey ? translate(item.labelKey, fallback || item.labelKey) : fallback
    return { ...item, label }
  })

  const collapsedCookie = cookieStore.get('om_sidebar_collapsed')?.value
  const initialCollapsed = collapsedCookie === '1'

  const rightHeaderContent = (
    <>
      <VectorSearchDialog apiKeyAvailable={vectorApiKeyAvailable} missingKeyMessage={vectorMissingKeyMessage} />
      <OrganizationSwitcher />
      <UserMenu email={auth?.email} />
    </>
  )

  const productName = translate('appShell.productName', 'Open Mercato')

  return (
    <AppShell
      key={path}
      productName={productName}
      email={auth?.email}
      groups={groups}
      currentTitle={currentTitle}
      breadcrumb={breadcrumb}
      sidebarCollapsedDefault={initialCollapsed}
      rightHeaderSlot={rightHeaderContent}
      adminNavApi="/api/auth/admin/nav"
    >
      {children}
    </AppShell>
  )
}
export const dynamic = 'force-dynamic'

function adoptSidebarDefaults(groups: NavGroup[]): NavGroup[] {
  const adoptItems = (items: NavItem[]): NavItem[] =>
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
