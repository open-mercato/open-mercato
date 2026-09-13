import * as React from 'react'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { BackendRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import type {
  BackendChromePayload,
  BackendChromeNavGroup,
  BackendChromeNavItem,
  BackendChromeSectionGroup,
  BackendChromeSectionItem,
} from '@open-mercato/shared/modules/navigation/backendChrome'
import {
  buildAdminNav,
  buildProfileSections,
  buildSettingsSections,
  computeSettingsPathPrefixes,
  convertToSectionNavGroups,
  mergeSectionsWithDiscovered,
  type AdminNavItem,
  type SettingsSection,
  type SettingsSectionItem,
} from '@open-mercato/ui/backend/utils/nav'
import { resolveRegisteredLucideIconNode } from '@open-mercato/ui/backend/icons/lucideRegistry'
import { profilePathPrefixes, profileSections } from './profile-sections'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getNavGroupOrderOverride } from '@open-mercato/shared/modules/overrides'
import {
  getSelectedOrganizationFromRequest,
  resolveFeatureCheckContext,
} from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  applySidebarPreference,
  findSidebarPreference,
  loadFirstRoleSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import type { SidebarPreferencesSettings } from '@open-mercato/shared/modules/navigation/sidebarPreferences'

type TranslationFn = (key: string | undefined, fallback: string) => string

type RouteModule = {
  id: string
  backendRoutes?: BackendRouteManifestEntry[]
}

export function groupBackendRoutesByModule(routes: BackendRouteManifestEntry[]): RouteModule[] {
  return Array.from(
    routes.reduce((grouped, route) => {
      const list = grouped.get(route.moduleId) ?? []
      list.push(route)
      grouped.set(route.moduleId, list)
      return grouped
    }, new Map<string, BackendRouteManifestEntry[]>()),
  ).map(([id, backendRoutes]) => ({ id, backendRoutes }))
}

type SerializableSectionItem = {
  id: string
  label: string
  labelKey?: string
  href: string
  icon?: React.ReactNode
  order?: number
  children?: SerializableSectionItem[]
}

type SerializableSectionGroup = {
  id: string
  label: string
  labelKey?: string
  order?: number
  items: SerializableSectionItem[]
}

type ResolvedNavItem = Omit<BackendChromeNavItem, 'defaultTitle' | 'children'> & {
  defaultTitle: string
  children?: ResolvedNavItem[]
}

type ResolveBackendChromePayloadArgs = {
  auth: Exclude<AuthContext, null>
  locale: string
  modules: RouteModule[]
  translate: TranslationFn
  request?: Request
  selectedOrganizationId?: string | null
  selectedTenantId?: string | null
}

/**
 * Settings section weights, keyed by the untranslated group id each page declares as `pageGroupKey`.
 *
 * Mirrors `defaultGroupOrder` above: an id, never a rendered label, so the panel keeps its intended
 * order in every locale and an app-side module can place its own section deterministically (#4843).
 */
export const settingsSectionOrder: Record<string, number> = {
  'settings.sections.system': 1,
  'settings.sections.auth': 2,
  'customer_accounts.settings.section': 3,
  'settings.sections.dataDesigner': 4,
  'settings.sections.moduleConfigs': 5,
  'currencies.nav.group': 6,
  'settings.sections.directory': 7,
  'settings.sections.featureToggles': 8,
}

/**
 * Profile section weights, keyed by the untranslated group id, exactly like `settingsSectionOrder`.
 *
 * Only the built-in account section is ranked; a module contributing its own profile group sorts
 * after it on the shared 999 fallback rather than displacing the account pages.
 */
export const profileSectionOrder: Record<string, number> = {
  'profile.sections.account': 1,
}

/**
 * Path prefixes that put the shell into profile mode: the static list plus every href the resolved
 * profile sections actually link to.
 *
 * `computeSettingsPathPrefixes` is deliberately not reused — it also registers each item's parent
 * directory, which is harmless for `/backend/settings/*` but would hand profile mode a whole
 * unrelated subtree if a module hosts its profile page outside `/backend/profile/`.
 */
function resolveProfilePathPrefixes(sections: SettingsSection[]): string[] {
  const prefixes = new Set(profilePathPrefixes)
  const visitItems = (items: SettingsSectionItem[]) => {
    for (const item of items) {
      prefixes.add(item.href)
      if (item.children?.length) visitItems(item.children)
    }
  }
  for (const section of sections) visitItems(section.items)
  return Array.from(prefixes)
}

type NavGroupWithWeight = Omit<BackendChromeNavGroup, 'id' | 'defaultName' | 'items'> & {
  id: string
  defaultName: string
  items: ResolvedNavItem[]
  weight: number
}

let renderToStaticMarkupPromise: Promise<typeof import('react-dom/server')> | null = null

async function serializeIconMarkup(icon: React.ReactNode | undefined): Promise<string | undefined> {
  if (!icon) return undefined
  if (!renderToStaticMarkupPromise) {
    renderToStaticMarkupPromise = import('react-dom/server')
  }
  const { renderToStaticMarkup } = await renderToStaticMarkupPromise

  const normalizedIcon = typeof icon === 'string'
    ? resolveRegisteredLucideIconNode(icon, 'size-4')
    : icon

  if (!normalizedIcon) return undefined

  try {
    const markup = renderToStaticMarkup(<>{normalizedIcon}</>)
    return markup.trim().length > 0 ? markup : undefined
  } catch {
    // Some icon values may be client-only component references after dependency upgrades.
    // Avoid taking down the entire nav payload because one icon cannot be rendered server-side.
    return undefined
  }
}

const NAV_ITEM_FALLBACK_WEIGHT = 10_000

/**
 * The weight a nav entry sorts by, using the same `priority ?? order` precedence as `buildAdminNav`.
 *
 * `serializeNavItem` emits this resolved number rather than the raw declaration, including the
 * fallback, so a consumer that re-sorts by the field it receives lands on the order it was served in.
 * Emitting the raw `priority ?? order` would leave `order` undefined on any page declaring neither —
 * and the `(a.order ?? 0) - (b.order ?? 0)` idiom this codebase uses elsewhere would then hoist those
 * pages to the top instead of leaving them last (#4845).
 */
function resolveNavItemWeight(item: AdminNavItem): number {
  return item.priority ?? item.order ?? NAV_ITEM_FALLBACK_WEIGHT
}

function sortNavItemsByWeight(items: AdminNavItem[]): AdminNavItem[] {
  return [...items].sort((a, b) => {
    const weightDifference = resolveNavItemWeight(a) - resolveNavItemWeight(b)
    if (weightDifference !== 0) return weightDifference
    return a.title.localeCompare(b.title)
  })
}

async function serializeNavItem(item: AdminNavItem): Promise<ResolvedNavItem> {
  return {
    id: item.href,
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    enabled: item.enabled,
    hidden: item.hidden,
    pageContext: item.pageContext,
    iconName: typeof item.icon === 'string' ? item.icon : undefined,
    iconMarkup: await serializeIconMarkup(item.icon),
    order: resolveNavItemWeight(item),
    children: item.children
      ? await Promise.all(sortNavItemsByWeight(item.children).map((child) => serializeNavItem(child)))
      : undefined,
  }
}

const defaultGroupOrder = [
  'customers.nav.group',
  'catalog.nav.group',
  'customers~sales.nav.group',
  'wms.nav.group',
  'resources.nav.group',
  'staff.nav.group',
  'entities.nav.group',
  'directory.nav.group',
  'attachments.nav.group',
]

/**
 * Group ids ranked ahead of everything else, most significant first.
 *
 * An app may prepend its own ids via `overrides.nav.groupOrder` in `modules.ts`; ids it does not name
 * keep the ordering they have today. With no override configured this returns `defaultGroupOrder`
 * itself, so ordering is unchanged for every existing install.
 */
function resolveGroupOrder(): string[] {
  const override = getNavGroupOrderOverride()
  if (!override || override.length === 0) return defaultGroupOrder
  const overridden = new Set(override)
  return [...override, ...defaultGroupOrder.filter((id) => !overridden.has(id))]
}

function normalizeGroupWeights(groups: NavGroupWithWeight[]): NavGroupWithWeight[] {
  const groupOrder = resolveGroupOrder()
  const groupOrderIndex = new Map(groupOrder.map((id, index) => [id, index]))
  groups.sort((a, b) => {
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
  const defaultGroupCount = groupOrder.length
  groups.forEach((group, index) => {
    const rank = groupOrderIndex.get(group.id)
    const fallbackWeight = typeof group.weight === 'number' ? group.weight : NAV_ITEM_FALLBACK_WEIGHT
    group.weight =
      (rank !== undefined ? rank : defaultGroupCount + index) * 1_000_000 +
      Math.min(Math.max(fallbackWeight, 0), 999_999)
  })
  return groups
}

async function groupEntries(entries: AdminNavItem[]): Promise<NavGroupWithWeight[]> {
  const groupMap = new Map<string, Omit<NavGroupWithWeight, 'items'> & { entries: AdminNavItem[] }>()
  for (const entry of entries) {
    const weight = resolveNavItemWeight(entry)
    const existing = groupMap.get(entry.groupId)
    if (existing) {
      existing.entries.push(entry)
      if (weight < existing.weight) existing.weight = weight
      continue
    }
    groupMap.set(entry.groupId, {
      id: entry.groupId,
      name: entry.group,
      defaultName: entry.groupDefaultName,
      entries: [entry],
      weight,
    })
  }
  const groups: NavGroupWithWeight[] = []
  for (const { entries: groupItems, ...group } of groupMap.values()) {
    groups.push({
      ...group,
      items: await Promise.all(sortNavItemsByWeight(groupItems).map((entry) => serializeNavItem(entry))),
    })
  }
  return normalizeGroupWeights(groups)
}

function adoptSidebarDefaults(groups: NavGroupWithWeight[]): NavGroupWithWeight[] {
  const adoptItems = (items: ResolvedNavItem[]): ResolvedNavItem[] =>
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

async function serializeSectionItem(item: {
  id: string
  label: string
  labelKey?: string
  href: string
  icon?: React.ReactNode
  order?: number
  children?: SerializableSectionItem[]
}): Promise<BackendChromeSectionItem> {
  return {
    id: item.id,
    label: item.label,
    labelKey: item.labelKey,
    href: item.href,
    order: item.order,
    iconName: typeof item.icon === 'string' ? item.icon : undefined,
    iconMarkup: await serializeIconMarkup(item.icon),
    children: item.children ? await Promise.all(item.children.map((child) => serializeSectionItem(child))) : undefined,
  }
}

async function serializeSectionGroups(groups: SerializableSectionGroup[]): Promise<BackendChromeSectionGroup[]> {
  return Promise.all(groups.map(async (group) => ({
    id: group.id,
    label: group.label,
    labelKey: group.labelKey,
    order: group.order,
    items: await Promise.all(group.items.map((item) => serializeSectionItem(item))),
  })))
}

async function loadScopedContainer(): Promise<AwilixContainer> {
  return createRequestContainer()
}

export async function resolveBackendChromePayload({
  auth,
  locale,
  modules,
  translate,
  request,
  selectedOrganizationId,
  selectedTenantId,
}: ResolveBackendChromePayloadArgs): Promise<BackendChromePayload> {
  const container = await loadScopedContainer()
  const em = container.resolve('em') as EntityManager
  const rbac = container.resolve('rbacService') as {
    getEffectiveFeatures: (userId: string, scope: { tenantId: string | null; organizationId: string | null }) => Promise<string[]>
    userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
  }

  let scopedOrganizationId: string | null = auth.orgId ?? null
  let scopedTenantId: string | null = auth.tenantId ?? null
  // The organization the caller actually *selected*, as distinct from the one the scope resolver fell
  // back to. `resolveFeatureCheckContext` resolves `organizationId` to `auth.orgId` when no concrete
  // organization is selected — which is precisely what an all-organizations view produces — so the
  // resolved id cannot answer "which organization am I viewing".
  let concretelySelectedOrganizationId: string | null = null
  let allowNavigation = true

  try {
    const { organizationId, scope, allowedOrganizationIds } = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      selectedId: selectedOrganizationId,
      tenantId: selectedTenantId,
    })
    scopedOrganizationId = organizationId
    scopedTenantId = scope.tenantId ?? auth.tenantId ?? null
    concretelySelectedOrganizationId = scope.selectedId ?? null
    if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
      allowNavigation = false
    }
  } catch {
    scopedOrganizationId = auth.orgId ?? null
    scopedTenantId = auth.tenantId ?? null
    concretelySelectedOrganizationId = null
  }

  const grantedFeatures = allowNavigation
    ? await rbac.getEffectiveFeatures(auth.sub, {
        tenantId: scopedTenantId,
        organizationId: scopedOrganizationId,
      })
    : []
  const featureChecker = async (features: string[]): Promise<string[]> => {
    if (!allowNavigation || !features.length) return []
    const context = {
      tenantId: scopedTenantId ?? auth.tenantId ?? null,
      organizationId: scopedOrganizationId ?? null,
    }
    const hasAll = await rbac.userHasAllFeatures(auth.sub, features, context)
    if (hasAll) return features

    const granted: string[] = []
    for (const feature of features) {
      const hasFeature = await rbac.userHasAllFeatures(auth.sub, [feature], context)
      if (hasFeature) granted.push(feature)
    }
    return granted
  }

  let userEntities: Array<{ entityId: string; label: string; href: string }> = []
  if (allowNavigation) {
    try {
      const where: FilterQuery<CustomEntity> = {
        isActive: true,
        showInSidebar: true,
      }
      where.$and = [
        { $or: [{ organizationId: scopedOrganizationId ?? undefined }, { organizationId: null }] },
        { $or: [{ tenantId: scopedTenantId ?? undefined }, { tenantId: null }] },
      ]
      const entities = await em.find(CustomEntity, where, { orderBy: { label: 'asc' } })
      userEntities = entities.map((entity) => ({
        entityId: entity.entityId,
        label: entity.label,
        href: `/backend/entities/user/${encodeURIComponent(entity.entityId)}/records`,
      }))
    } catch {
      userEntities = []
    }
  }

  const ctxAuth = {
    roles: auth.roles || [],
    sub: auth.sub,
    tenantId: scopedTenantId,
    orgId: scopedOrganizationId,
  }
  const entries = allowNavigation
    ? await buildAdminNav(
        modules,
        { auth: ctxAuth },
        userEntities,
        translate,
        { checkFeatures: featureChecker },
      )
    : []

  let rolePreference: SidebarPreferencesSettings | null = null
  let userPreference: SidebarPreferencesSettings | null = null

  if (Array.isArray(auth.roles) && auth.roles.length > 0) {
    const roleRecords = scopedTenantId
      ? await em.find(Role, {
          name: { $in: auth.roles },
          tenantId: scopedTenantId,
        })
      : []
    const roleIds = Array.isArray(roleRecords) ? roleRecords.map((role) => role.id) : []
    if (roleIds.length > 0) {
      rolePreference = await loadFirstRoleSidebarPreference(em, {
        roleIds,
        tenantId: scopedTenantId,
        locale,
      })
    }
  }

  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (effectiveUserId) {
    userPreference = await findSidebarPreference(em, {
      userId: effectiveUserId,
      tenantId: scopedTenantId,
      organizationId: scopedOrganizationId,
      locale,
    })
  }

  const baseGroups = await groupEntries(entries)
  const groupsWithRole = rolePreference
    ? applySidebarPreference<NavGroupWithWeight>(baseGroups, rolePreference)
    : baseGroups
  const baseForUser = adoptSidebarDefaults(groupsWithRole)
  const appliedGroups = userPreference
    ? applySidebarPreference<NavGroupWithWeight>(baseForUser, userPreference)
    : baseForUser

  const settingsSections = await serializeSectionGroups(
    convertToSectionNavGroups(
      buildSettingsSections(entries, settingsSectionOrder),
      translate,
    ),
  )

  // The profile sidebar mirrors the profile dropdown: the static baseline covers the `navHidden`
  // pages route discovery drops, and every other `pageContext: 'profile'` page is derived from the
  // manifest so a module adding one lands in both surfaces at once (#5594).
  const resolvedProfileSections = mergeSectionsWithDiscovered(
    profileSections,
    buildProfileSections(entries, profileSectionOrder),
  )

  const requestOrganizationId = request ? getSelectedOrganizationFromRequest(request) : null
  const fallbackOrganizationId = selectedOrganizationId ?? requestOrganizationId ?? auth.orgId ?? null
  const brandOrganizationId = scopedOrganizationId
    ?? (fallbackOrganizationId && !isAllOrganizationsSelection(fallbackOrganizationId) ? fallbackOrganizationId : null)

  let brand: BackendChromePayload['brand'] = null
  // Resolved here rather than left to callers. `brand` only populates when the organization has a
  // logo, so it is a branding channel, not a dependable "which organization am I viewing" source.
  // Without this field every downstream app has to fetch `/api/directory/organization-switcher` and
  // walk its tree for the selected id. The row is already loaded below, so the name costs nothing.
  let currentOrganization: BackendChromePayload['currentOrganization'] = null
  if (brandOrganizationId && scopedTenantId) {
    try {
      const organization = await findOneWithDecryption(
        em,
        Organization,
        { id: brandOrganizationId, tenant: scopedTenantId, deletedAt: null },
        undefined,
        { tenantId: scopedTenantId, organizationId: brandOrganizationId },
      )
      // Only when a concrete organization was selected. Under an all-organizations view
      // `brandOrganizationId` still resolves (to the caller's own organization, which is what keeps
      // branding working), so gating on the loaded row alone would misreport the scope.
      if (organization && concretelySelectedOrganizationId === brandOrganizationId) {
        currentOrganization = { id: String(organization.id), name: organization.name }
      }
      if (organization?.logoUrl) {
        brand = {
          name: organization.name,
          logo: {
            src: organization.logoUrl,
            alt: `${organization.name} logo`,
            preserveAspectRatio: !!organization.logoPreserveAspectRatio,
          },
        }
      }
    } catch {
      // Fail soft, as before: a failed organization lookup must not take down the nav payload.
      brand = null
      currentOrganization = null
    }
  }

  return {
    groups: appliedGroups.map(({ weight: _weight, ...group }) => group),
    settingsSections,
    settingsPathPrefixes: computeSettingsPathPrefixes(buildSettingsSections(entries, settingsSectionOrder)),
    profileSections: await serializeSectionGroups(
      convertToSectionNavGroups(resolvedProfileSections, translate),
    ),
    profilePathPrefixes: resolveProfilePathPrefixes(resolvedProfileSections),
    grantedFeatures,
    roles: Array.isArray(auth.roles) ? auth.roles : [],
    brand,
    currentOrganization,
  }
}
