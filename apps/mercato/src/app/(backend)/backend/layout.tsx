import { cookies, headers } from 'next/headers'
import Script from 'next/script'
import type { ReactNode } from 'react'
import { modules } from '@/.mercato/generated/modules.generated'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { AppShell } from '@open-mercato/ui/backend/AppShell'
import { buildAdminNav } from '@open-mercato/ui/backend/utils/nav'
import type { AdminNavItem } from '@open-mercato/ui/backend/utils/nav'
import { UserMenu } from '@open-mercato/ui/backend/UserMenu'
import { GlobalSearchDialog } from '@open-mercato/search/modules/search/frontend'
import OrganizationSwitcher from '@/components/OrganizationSwitcher'
import { NotificationBellWrapper } from '@/components/NotificationBellWrapper'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  applySidebarPreference,
  loadFirstRoleSidebarPreference,
  loadSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import type { SidebarPreferencesSettings } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import { PageInjectionBoundary } from '@open-mercato/ui/backend/injection/PageInjectionBoundary'

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

export default async function BackendLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug?: string[] }> }) {
  const auth = await getAuthFromCookies()
  const cookieStore = await cookies()
  const headerStore = await headers()
  const rawSelectedOrg = cookieStore.get('om_selected_org')?.value
  const rawSelectedTenant = cookieStore.get('om_selected_tenant')?.value
  const selectedOrgForScope = rawSelectedOrg === undefined
    ? undefined
    : rawSelectedOrg && rawSelectedOrg.trim().length > 0
      ? rawSelectedOrg
      : null
  const selectedTenantForScope = rawSelectedTenant === undefined
    ? undefined
    : rawSelectedTenant && rawSelectedTenant.trim().length > 0
      ? rawSelectedTenant
      : null

  let requestContainer: AwilixContainer | null = null
  const ensureContainer = async (): Promise<AwilixContainer> => {
    if (!requestContainer) {
      requestContainer = await createRequestContainer()
    }
    return requestContainer
  }

  let path = headerStore.get('x-next-url') ?? ''
  if (path.includes('?')) path = path.split('?')[0]
  let resolvedParams: { slug?: string[] } = {}
  try {
    resolvedParams = await params
  } catch {
    resolvedParams = {}
  }
  if (!path) {
    const slug = resolvedParams.slug ?? []
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

  const { translate, locale, dict } = await resolveTranslations()
  const embeddingConfigured = Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.COHERE_API_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.OLLAMA_BASE_URL
  )
  const missingConfigMessage = translate('search.messages.missingConfig', 'Search requires configuring an embedding provider for semantic search.')

  const featureChecker = auth
    ? async (features: string[]): Promise<Set<string>> => {
        if (!features?.length) return new Set()
        try {
          const container = await ensureContainer()
          const rbac = container.resolve<RbacService>('rbacService')
          const { organizationId, scope, allowedOrganizationIds } = await resolveFeatureCheckContext({
            container,
            auth,
            selectedId: selectedOrgForScope,
            tenantId: selectedTenantForScope,
          })
          if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
            return new Set()
          }
          const tenantForCheck = scope.tenantId ?? auth.tenantId ?? null
          const orgForCheck = organizationId ?? null
          const context = { tenantId: tenantForCheck, organizationId: orgForCheck }
          const hasAll = await rbac.userHasAllFeatures(auth.sub, features, context)
          if (hasAll) return new Set(features)
          const granted: string[] = []
          for (const feature of features) {
            const hasFeature = await rbac.userHasAllFeatures(auth.sub, [feature], context)
            if (hasFeature) granted.push(feature)
          }
          return new Set(granted)
        } catch {
          return new Set()
        }
      }
    : undefined

  const entries = await buildAdminNav(
    modules,
    ctx,
    undefined,
    (key, fallback) => (key ? translate(key, fallback) : fallback),
    featureChecker ? { checkFeatures: featureChecker } : undefined,
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
  const defaultGroupOrder = [
    'customers.nav.group',
    'catalog.nav.group',
    'customers~sales.nav.group',
    'resources.nav.group',
    'staff.nav.group',
    'entities.nav.group',
    'directory.nav.group',
    'customers.storage.nav.group',
  ]
  const groupOrderIndex = new Map(defaultGroupOrder.map((id, index) => [id, index]))
  baseGroups.sort((a, b) => {
    const aIndex = groupOrderIndex.get(a.id)
    const bIndex = groupOrderIndex.get(b.id)
    if (aIndex !== undefined || bIndex !== undefined) {
      if (aIndex === undefined) return 1
      if (bIndex === undefined) return -1
      if (aIndex !== bIndex) return aIndex - bIndex
    }
    if (a.weight !== b.weight) return a.weight - b.weight
    return a.name.localeCompare(b.name)
  })
  const defaultGroupCount = defaultGroupOrder.length
  baseGroups.forEach((group, index) => {
    const rank = groupOrderIndex.get(group.id)
    const fallbackWeight = typeof group.weight === 'number' ? group.weight : 10_000
    const normalized =
      (rank !== undefined ? rank : defaultGroupCount + index) * 1_000_000 +
      Math.min(Math.max(fallbackWeight, 0), 999_999)
    group.weight = normalized
  })

  let rolePreference: SidebarPreferencesSettings | null = null
  let sidebarPreference: SidebarPreferencesSettings | null = null
  if (auth) {
    try {
      const container = await ensureContainer()
      const em = container.resolve('em') as EntityManager
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
      // For API key auth, use userId (the actual user) if available
      const effectiveUserId: string | undefined = auth.isApiKey ? auth.userId : auth.sub
      if (effectiveUserId) {
        sidebarPreference = await loadSidebarPreference(em, {
          userId: effectiveUserId,
          tenantId: auth.tenantId ?? null,
          organizationId: auth.orgId ?? null,
          locale,
        })
      }
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
      <GlobalSearchDialog embeddingConfigured={embeddingConfigured} missingConfigMessage={missingConfigMessage} />
      <OrganizationSwitcher />
      <UserMenu email={auth?.email} />
      <NotificationBellWrapper />
    </>
  )

  const deployEnv = process.env.DEPLOY_ENV
  const baseProductName = translate('appShell.productName', 'Open Mercato')
  const productName = deployEnv && deployEnv !== 'local'
    ? `${baseProductName} (${deployEnv.charAt(0).toUpperCase() + deployEnv.slice(1)})`
    : baseProductName
  const injectionContext = {
    path,
    userId: auth?.sub ?? null,
    tenantId: auth?.tenantId ?? null,
    organizationId: auth?.orgId ?? null,
  }

  return (
    <>
      <Script async src="https://w.appzi.io/w.js?token=TtIV6" strategy="afterInteractive" />
      <I18nProvider locale={locale} dict={dict}>
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
          version={APP_VERSION}
        >
          <PageInjectionBoundary path={path} context={injectionContext}>
            {children}
          </PageInjectionBoundary>
        </AppShell>
      </I18nProvider>
    </>
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
