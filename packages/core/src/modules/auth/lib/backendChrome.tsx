import * as React from 'react'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { Module } from '@open-mercato/shared/modules/registry'
import type {
  BackendChromePayload,
  BackendChromeNavGroup,
  BackendChromeNavItem,
  BackendChromeSectionGroup,
  BackendChromeSectionItem,
} from '@open-mercato/shared/modules/navigation/backendChrome'
import {
  buildAdminNav,
  buildSettingsSections,
  computeSettingsPathPrefixes,
  convertToSectionNavGroups,
  type AdminNavItem,
} from '@open-mercato/ui/backend/utils/nav'
import { profilePathPrefixes, profileSections } from './profile-sections'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import {
  applySidebarPreference,
  loadFirstRoleSidebarPreference,
  loadSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import type { SidebarPreferencesSettings } from '@open-mercato/shared/modules/navigation/sidebarPreferences'

type TranslationFn = (key: string | undefined, fallback: string) => string

type RouteModule = Pick<Module, 'id' | 'backendRoutes'>

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

const settingsSectionOrder: Record<string, number> = {
  system: 1,
  auth: 2,
  'customer-portal': 3,
  'data-designer': 4,
  'module-configs': 5,
  directory: 6,
  'feature-toggles': 7,
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
  const markup = renderToStaticMarkup(<>{icon}</>)
  return markup.trim().length > 0 ? markup : undefined
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
    iconMarkup: await serializeIconMarkup(item.icon),
    children: item.children ? await Promise.all(item.children.map((child) => serializeNavItem(child))) : undefined,
  }
}

function normalizeGroupWeights(groups: NavGroupWithWeight[]): NavGroupWithWeight[] {
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
  const defaultGroupCount = defaultGroupOrder.length
  groups.forEach((group, index) => {
    const rank = groupOrderIndex.get(group.id)
    const fallbackWeight = typeof group.weight === 'number' ? group.weight : 10_000
    group.weight =
      (rank !== undefined ? rank : defaultGroupCount + index) * 1_000_000 +
      Math.min(Math.max(fallbackWeight, 0), 999_999)
  })
  return groups
}

async function groupEntries(entries: AdminNavItem[]): Promise<NavGroupWithWeight[]> {
  const groupMap = new Map<string, NavGroupWithWeight>()
  for (const entry of entries) {
    const weight = entry.priority ?? entry.order ?? 10_000
    const serializedItem = await serializeNavItem(entry)
    const existing = groupMap.get(entry.groupId)
    if (existing) {
      existing.items.push(serializedItem)
      if (weight < existing.weight) existing.weight = weight
      continue
    }
    groupMap.set(entry.groupId, {
      id: entry.groupId,
      name: entry.group,
      defaultName: entry.groupDefaultName,
      items: [serializedItem],
      weight,
    })
  }
  return normalizeGroupWeights(Array.from(groupMap.values()))
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
    loadAcl: (userId: string, scope: { tenantId: string | null; organizationId: string | null }) => Promise<{
      isSuperAdmin: boolean
      features: string[]
    }>
    userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
  }

  let scopedOrganizationId: string | null = auth.orgId ?? null
  let scopedTenantId: string | null = auth.tenantId ?? null
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
    if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
      allowNavigation = false
    }
  } catch {
    scopedOrganizationId = auth.orgId ?? null
    scopedTenantId = auth.tenantId ?? null
  }

  const acl = allowNavigation
    ? await rbac.loadAcl(auth.sub, {
        tenantId: scopedTenantId,
        organizationId: scopedOrganizationId,
      })
    : { isSuperAdmin: false, features: [] }

  const grantedFeatures = acl.isSuperAdmin ? ['*'] : acl.features
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
    const roleScope: FilterQuery<Role> = scopedTenantId
      ? { $or: [{ tenantId: scopedTenantId }, { tenantId: null }] }
      : { tenantId: null }
    const roleRecords = await em.find(Role, {
      name: { $in: auth.roles },
      ...roleScope,
    })
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
    userPreference = await loadSidebarPreference(em, {
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

  return {
    groups: appliedGroups.map(({ weight: _weight, ...group }) => group),
    settingsSections,
    settingsPathPrefixes: computeSettingsPathPrefixes(buildSettingsSections(entries, settingsSectionOrder)),
    profileSections: await serializeSectionGroups(profileSections),
    profilePathPrefixes,
    grantedFeatures,
    roles: Array.isArray(auth.roles) ? auth.roles : [],
  }
}
