import { EntityManager } from '@mikro-orm/postgresql'
import { User, UserSidebarPreference } from '../data/entities'
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
  const applyItems = <TI extends SidebarItemLike>(items: TI[]): TI[] => {
    return items.map((item) => {
      const override = normalized.itemLabels?.[item.href]
      const nextChildren = item.children ? applyItems(item.children) : undefined
      return {
        ...item,
        title: override && override.trim().length > 0 ? override.trim() : item.defaultTitle,
        children: nextChildren,
      }
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
