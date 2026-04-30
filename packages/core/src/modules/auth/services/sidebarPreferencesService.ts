import { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, RoleSidebarPreference, SidebarVariant, User, UserSidebarPreference } from '../data/entities'
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
  id?: string
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
  // Cross-locale: variants & preferences are scoped per (user, tenant, org) only.
  // The `locale` field on the row is kept for audit / when the row was created.
  const { userId, tenantId, organizationId } = normalizeScope(scope)
  const existing = await findOneWithDecryption(
    em,
    UserSidebarPreference,
    { user: userId, tenantId, organizationId },
    undefined,
    { tenantId, organizationId },
  )
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
  let pref = await findOneWithDecryption(
    em,
    UserSidebarPreference,
    { user: userId, tenantId, organizationId },
    undefined,
    { tenantId, organizationId },
  )
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
  options: { roleIds: string[]; tenantId?: string | null; locale?: string },
): Promise<Map<string, SidebarPreferencesSettings>> {
  if (!options.roleIds.length) return new Map()
  const tenantId = options.tenantId ?? null
  const tenantFilter = tenantId === null ? null : { $in: [tenantId, null] }
  const prefs = await findWithDecryption(
    em,
    RoleSidebarPreference,
    { role: { $in: options.roleIds }, tenantId: tenantFilter as any },
    undefined,
    { tenantId, organizationId: null },
  )
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
  options: { roleIds: string[]; tenantId?: string | null; locale?: string },
): Promise<SidebarPreferencesSettings | null> {
  if (!options.roleIds.length) return null
  const tenantId = options.tenantId ?? null
  const tenantFilter = tenantId === null ? null : { $in: [tenantId, null] }
  const prefs = await findWithDecryption(
    em,
    RoleSidebarPreference,
    { role: { $in: options.roleIds }, tenantId: tenantFilter as any },
    undefined,
    { tenantId, organizationId: null },
  )
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
  let pref = await findOneWithDecryption(
    em,
    RoleSidebarPreference,
    { role: roleId, tenantId },
    undefined,
    { tenantId, organizationId: null },
  )
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
  const resolveItemKey = (item: SidebarItemLike): string => {
    const candidate = item.id?.trim()
    if (candidate && candidate.length > 0) return candidate
    return item.href
  }
  const applyItems = <TI extends SidebarItemLike>(items: TI[]): TI[] => {
    return items.map((item) => {
      const itemKey = resolveItemKey(item)
      const override = normalized.itemLabels?.[itemKey] ?? normalized.itemLabels?.[item.href]
      const nextChildren = item.children ? applyItems(item.children) : undefined
      const hidden = hiddenSet.has(itemKey) || hiddenSet.has(item.href)
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

// --- Named variants (per-user library of saved sidebar layouts) ----------------

export type VariantScope = {
  userId: string
  tenantId?: string | null
  organizationId?: string | null
  locale: string
}

export type SidebarVariantRecord = {
  id: string
  name: string
  isActive: boolean
  settings: SidebarPreferencesSettings
  createdAt: Date
  updatedAt?: Date | null
}

function toVariantRecord(variant: SidebarVariant): SidebarVariantRecord {
  return {
    id: variant.id,
    name: variant.name,
    isActive: variant.isActive === true,
    settings: normalizeSidebarSettings(variant.settingsJson as SidebarPreferencesSettings | undefined),
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt ?? null,
  }
}

export async function listSidebarVariants(
  em: EntityManager,
  scope: VariantScope,
): Promise<SidebarVariantRecord[]> {
  // Cross-locale: variants are scoped per (user, tenant) only.
  const { userId, tenantId, organizationId } = normalizeVariantScope(scope)
  const variants = await findWithDecryption(
    em,
    SidebarVariant,
    { user: userId, tenantId, deletedAt: null },
    { orderBy: { createdAt: 'asc' } },
    { tenantId, organizationId },
  )
  return variants.map(toVariantRecord)
}

export async function loadSidebarVariant(
  em: EntityManager,
  scope: VariantScope,
  variantId: string,
): Promise<SidebarVariantRecord | null> {
  const { userId, tenantId, organizationId } = normalizeVariantScope(scope)
  const variant = await findOneWithDecryption(
    em,
    SidebarVariant,
    { id: variantId, user: userId, tenantId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  return variant ? toVariantRecord(variant) : null
}

export async function nextVariantAutoName(
  em: EntityManager,
  scope: VariantScope,
  prefix = 'My preferences',
): Promise<string> {
  const variants = await listSidebarVariants(em, scope)
  // Match names like "My preferences", "My preferences 2", "My preferences 17"
  const usedNumbers = new Set<number>()
  for (const variant of variants) {
    if (variant.name === prefix) {
      usedNumbers.add(1)
      continue
    }
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = variant.name.match(new RegExp(`^${escaped}\\s+(\\d+)$`))
    if (match) {
      const n = Number.parseInt(match[1], 10)
      if (!Number.isNaN(n)) usedNumbers.add(n)
    }
  }
  if (!usedNumbers.has(1)) return prefix
  let next = 2
  while (usedNumbers.has(next)) next += 1
  return `${prefix} ${next}`
}

export async function createSidebarVariant(
  em: EntityManager,
  scope: VariantScope,
  input: {
    name?: string | null
    settings?: SidebarPreferencesSettings | null
    isActive?: boolean
  },
): Promise<SidebarVariantRecord> {
  const { userId, tenantId, organizationId, locale } = normalizeVariantScope(scope)
  const finalName = (input.name ?? '').trim() || (await nextVariantAutoName(em, scope))
  const settings = normalizeSidebarSettings({
    ...(input.settings ?? {}),
    version: input.settings?.version ?? SIDEBAR_PREFERENCES_VERSION,
  })

  if (input.isActive === true) {
    await deactivateAllVariants(em, scope)
  }

  const variant = em.create(SidebarVariant, {
    user: em.getReference(User, userId),
    tenantId,
    organizationId,
    locale,
    name: finalName,
    settingsJson: settings,
    isActive: input.isActive === true,
    createdAt: new Date(),
  })
  await em.flush()
  return toVariantRecord(variant)
}

export async function updateSidebarVariant(
  em: EntityManager,
  scope: VariantScope,
  variantId: string,
  input: {
    name?: string
    settings?: SidebarPreferencesSettings | null
    isActive?: boolean
  },
): Promise<SidebarVariantRecord | null> {
  const { userId, tenantId, organizationId } = normalizeVariantScope(scope)
  const variant = await findOneWithDecryption(
    em,
    SidebarVariant,
    { id: variantId, user: userId, tenantId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!variant) return null
  if (typeof input.name === 'string' && input.name.trim().length > 0) {
    variant.name = input.name.trim()
  }
  if (input.settings) {
    variant.settingsJson = normalizeSidebarSettings({
      ...input.settings,
      version: input.settings.version ?? SIDEBAR_PREFERENCES_VERSION,
    })
  }
  if (typeof input.isActive === 'boolean') {
    if (input.isActive) {
      await deactivateAllVariants(em, scope, variantId)
    }
    variant.isActive = input.isActive
  }
  await em.flush()
  return toVariantRecord(variant)
}

export async function deleteSidebarVariant(
  em: EntityManager,
  scope: VariantScope,
  variantId: string,
): Promise<boolean> {
  const { userId, tenantId, organizationId } = normalizeVariantScope(scope)
  const variant = await findOneWithDecryption(
    em,
    SidebarVariant,
    { id: variantId, user: userId, tenantId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!variant) return false
  variant.deletedAt = new Date()
  variant.isActive = false
  await em.flush()
  return true
}

async function deactivateAllVariants(
  em: EntityManager,
  scope: VariantScope,
  exceptId?: string,
): Promise<void> {
  const { userId, tenantId } = normalizeVariantScope(scope)
  const where: Record<string, unknown> = {
    user: userId,
    tenantId,
    isActive: true,
    deletedAt: null,
  }
  if (exceptId) where.id = { $ne: exceptId }
  await em.nativeUpdate(SidebarVariant, where as any, { isActive: false })
}

function normalizeVariantScope(scope: VariantScope) {
  return {
    userId: scope.userId,
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
    locale: scope.locale,
  }
}
