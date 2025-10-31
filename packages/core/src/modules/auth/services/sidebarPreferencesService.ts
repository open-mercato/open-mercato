import { EntityManager } from '@mikro-orm/postgresql'
import { Role, RoleSidebarPreference, User, UserSidebarPreference } from '../data/entities'
import {
  SIDEBAR_PREFERENCES_VERSION,
  SidebarPreferencesSettings,
  normalizeSidebarSettings,
} from '@open-mercato/shared/modules/navigation/sidebarPreferences'

export type SidebarPreferenceScope = {
  userId: string
  tenantId?: string | null
  organizationId?: string | null
  locale: string
}

export type RoleSidebarPreferenceScope = {
  roleId: string
  tenantId?: string | null
  locale: string
}

export type SidebarItemLike<T = Record<string, unknown>> = {
  href: string
  title: string
  defaultTitle: string
  children?: SidebarItemLike<T>[]
} & T

export type SidebarGroupLike<T = Record<string, unknown>> = {
  id: string
  name: string
  defaultName: string
  items: SidebarItemLike<T>[]
  weight?: number
} & T

export async function loadSidebarPreference(
  em: EntityManager,
  scope: SidebarPreferenceScope,
): Promise<SidebarPreferencesSettings> {
  const { userId, tenantId, organizationId, locale } = normalizeScope(scope)
  const existing = await em.findOne(UserSidebarPreference, { user: userId, tenantId, organizationId, locale })
  return normalizeSidebarSettings(existing?.settingsJson as SidebarPreferencesSettings | undefined)
}

export async function saveSidebarPreference(
  em: EntityManager,
  scope: SidebarPreferenceScope,
  input: SidebarPreferencesSettings,
): Promise<SidebarPreferencesSettings> {
  const normalized = normalizeSidebarSettings({
    ...input,
    version: input?.version ?? SIDEBAR_PREFERENCES_VERSION,
  })
  const { userId, tenantId, organizationId, locale } = normalizeScope(scope)
  let pref = await em.findOne(UserSidebarPreference, { user: userId, tenantId, organizationId, locale })
  if (!pref) {
    pref = em.create(UserSidebarPreference, {
      user: em.getReference(User, userId),
      tenantId,
      organizationId,
      locale,
      settingsJson: normalized,
      createdAt: new Date(),
    })
  } else {
    pref.settingsJson = normalized
  }
  await em.flush()
  return normalized
}

export async function loadRoleSidebarPreferences(
  em: EntityManager,
  options: { roleIds: string[]; tenantId?: string | null; locale: string },
): Promise<Map<string, SidebarPreferencesSettings>> {
  if (!options.roleIds.length) return new Map()
  const tenantId = options.tenantId ?? null
  const tenantFilter = tenantId === null ? null : { $in: [tenantId, null] }
  const prefs = await em.find(RoleSidebarPreference, {
    role: { $in: options.roleIds },
    tenantId: tenantFilter,
    locale: options.locale,
  })
  const map = new Map<string, SidebarPreferencesSettings>()
  for (const pref of prefs) {
    const key = pref.role.id
    if (tenantId !== null) {
      const existing = map.get(key)
      if (existing && pref.tenantId === null) continue
      if (!existing || pref.tenantId === tenantId) {
        map.set(key, normalizeSidebarSettings(pref.settingsJson as SidebarPreferencesSettings | undefined))
      }
      continue
    }
    map.set(key, normalizeSidebarSettings(pref.settingsJson as SidebarPreferencesSettings | undefined))
  }
  return map
}

export async function loadFirstRoleSidebarPreference(
  em: EntityManager,
  options: { roleIds: string[]; tenantId?: string | null; locale: string },
): Promise<SidebarPreferencesSettings | null> {
  if (!options.roleIds.length) return null
  const tenantId = options.tenantId ?? null
  const tenantFilter = tenantId === null ? null : { $in: [tenantId, null] }
  const prefs = await em.find(RoleSidebarPreference, {
    role: { $in: options.roleIds },
    tenantId: tenantFilter,
    locale: options.locale,
  })
  if (!prefs.length) return null
  const ordered = options.roleIds
    .map((id) => {
      if (tenantId !== null) {
        const specific = prefs.find((pref) => pref.role.id === id && pref.tenantId === tenantId)
        if (specific) return specific
      }
      return prefs.find((pref) => pref.role.id === id && pref.tenantId === null)
    })
    .filter(Boolean) as RoleSidebarPreference[]
  const first = ordered[0] ?? prefs[0]
  return normalizeSidebarSettings(first?.settingsJson as SidebarPreferencesSettings | undefined)
}

export async function saveRoleSidebarPreference(
  em: EntityManager,
  scope: RoleSidebarPreferenceScope,
  input: SidebarPreferencesSettings,
): Promise<SidebarPreferencesSettings> {
  const normalized = normalizeSidebarSettings({
    ...input,
    version: input?.version ?? SIDEBAR_PREFERENCES_VERSION,
  })
  const { roleId, tenantId, locale } = normalizeRoleScope(scope)
  let pref = await em.findOne(RoleSidebarPreference, { role: roleId, tenantId, locale })
  if (!pref) {
    pref = em.create(RoleSidebarPreference, {
      role: em.getReference(Role, roleId),
      tenantId,
      locale,
      settingsJson: normalized,
      createdAt: new Date(),
    })
  } else {
    pref.settingsJson = normalized
  }
  await em.flush()
  return normalized
}

export function applySidebarPreference<T extends SidebarGroupLike>(
  groups: T[],
  settings?: SidebarPreferencesSettings | null,
): T[] {
  const normalized = normalizeSidebarSettings(settings)
  const orderIndex = new Map<string, number>()
  normalized.groupOrder?.forEach((id, idx) => {
    if (!orderIndex.has(id)) orderIndex.set(id, idx)
  })
  const hiddenSet = new Set(normalized.hiddenItems ?? [])
  const applyItems = <TI extends SidebarItemLike>(items: TI[]): TI[] => {
    return items.map((item) => {
      const override = normalized.itemLabels?.[item.href]
      const nextChildren = item.children ? applyItems(item.children) : undefined
      const hidden = hiddenSet.has(item.href)
      const next = {
        ...item,
        title: override && override.trim().length > 0 ? override.trim() : item.defaultTitle,
        children: nextChildren,
      } as TI & { hidden?: boolean }
      next.hidden = hidden
      return next
    })
  }
  const mapped = groups.map((group) => {
    const override = normalized.groupLabels?.[group.id]
    return {
      ...group,
      name: override && override.trim().length > 0 ? override.trim() : group.defaultName,
      items: applyItems(group.items),
    }
  })
  mapped.sort((a, b) => {
    const ao = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.POSITIVE_INFINITY
    const bo = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    const aw = typeof a.weight === 'number' ? a.weight : 10_000
    const bw = typeof b.weight === 'number' ? b.weight : 10_000
    if (aw !== bw) return aw - bw
    return a.defaultName.localeCompare(b.defaultName)
  })
  return mapped
}

function normalizeScope(scope: SidebarPreferenceScope) {
  return {
    userId: scope.userId,
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
    locale: scope.locale,
  }
}

function normalizeRoleScope(scope: RoleSidebarPreferenceScope) {
  return {
    roleId: scope.roleId,
    tenantId: scope.tenantId ?? null,
    locale: scope.locale,
  }
}
