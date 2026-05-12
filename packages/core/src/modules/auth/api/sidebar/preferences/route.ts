import { NextResponse } from 'next/server'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  sidebarPreferencesInputSchema,
  sidebarPreferencesScopeSchema,
} from '../../../data/validators'
import {
  loadRoleSidebarPreferences,
  loadSidebarPreference,
  saveRoleSidebarPreference,
  saveSidebarPreference,
} from '../../../services/sidebarPreferencesService'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { Role, RoleSidebarPreference } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'

export const metadata = {
  GET: { requireAuth: true },
  PUT: { requireAuth: true, requireFeatures: ['auth.sidebar.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.sidebar.manage'] },
}

const sidebarSettingsSchema = z.object({
  version: z.number().int().positive(),
  groupOrder: z.array(z.string()),
  groupLabels: z.record(z.string(), z.string()),
  itemLabels: z.record(z.string(), z.string()),
  hiddenItems: z.array(z.string()),
  itemOrder: z.record(z.string(), z.array(z.string())),
})

const sidebarRoleEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  hasPreference: z.boolean(),
})

const sidebarPreferencesResponseSchema = z.object({
  locale: z.string(),
  settings: sidebarSettingsSchema,
  canApplyToRoles: z.boolean(),
  roles: z.array(sidebarRoleEntrySchema),
  scope: sidebarPreferencesScopeSchema,
})

const sidebarPreferencesUpdateResponseSchema = sidebarPreferencesResponseSchema.extend({
  appliedRoles: z.array(z.string().uuid()),
  clearedRoles: z.array(z.string().uuid()),
})

const sidebarPreferencesDeleteResponseSchema = z.object({
  ok: z.literal(true),
  scope: sidebarPreferencesScopeSchema,
})

const sidebarErrorSchema = z.object({
  error: z.string(),
})

const FEATURE_MANAGE = 'auth.sidebar.manage'

type EmptySettings = {
  version: number
  groupOrder: string[]
  groupLabels: Record<string, string>
  itemLabels: Record<string, string>
  hiddenItems: string[]
  itemOrder: Record<string, string[]>
}

function emptySettings(): EmptySettings {
  return {
    version: SIDEBAR_PREFERENCES_VERSION,
    groupOrder: [],
    groupLabels: {},
    itemLabels: {},
    hiddenItems: [],
    itemOrder: {},
  }
}

async function loadRolesPayload(
  em: EntityManager,
  options: { tenantId: string | null; locale: string },
): Promise<Array<{ id: string; name: string; hasPreference: boolean }>> {
  const roleScope: FilterQuery<Role> = options.tenantId
    ? { $or: [{ tenantId: options.tenantId }, { tenantId: null }] }
    : { tenantId: null }
  const roles = await findWithDecryption(
    em,
    Role,
    roleScope,
    { orderBy: { name: 'asc' } },
    { tenantId: options.tenantId, organizationId: null },
  )
  if (roles.length === 0) return []
  const rolePrefs = await loadRoleSidebarPreferences(em, {
    roleIds: roles.map((r: Role) => r.id),
    tenantId: options.tenantId,
    locale: options.locale,
  })
  return roles.map((role: Role) => ({
    id: role.id,
    name: role.name,
    hasPreference: rolePrefs.has(role.id),
  }))
}

async function findRoleInScope(
  em: EntityManager,
  options: { roleId: string; tenantId: string | null },
): Promise<Role | null> {
  const role = await findOneWithDecryption(
    em,
    Role,
    { id: options.roleId },
    undefined,
    { tenantId: options.tenantId, organizationId: null },
  )
  if (!role) return null
  // Cross-tenant guard: a role belongs to either the auth tenant or the global (null tenant) pool.
  // Reject the lookup otherwise so a multi-tenant deployment can't leak across tenants.
  if (role.tenantId && options.tenantId && role.tenantId !== options.tenantId) return null
  if (role.tenantId && !options.tenantId) return null
  return role
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const roleIdParam = url.searchParams.get('roleId')

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const rbac = resolve('rbacService') as any

  const canApplyToRoles = await rbac.userHasAllFeatures?.(
    auth.sub,
    [FEATURE_MANAGE],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ) ?? false

  // Role-scoped read: requires `auth.sidebar.manage`.
  if (roleIdParam) {
    if (!canApplyToRoles) {
      return NextResponse.json({ error: 'Forbidden', requiredFeatures: [FEATURE_MANAGE] }, { status: 403 })
    }
    const role = await findRoleInScope(em, { roleId: roleIdParam, tenantId: auth.tenantId ?? null })
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    }
    const rolePrefs = await loadRoleSidebarPreferences(em, {
      roleIds: [role.id],
      tenantId: auth.tenantId ?? null,
      locale,
    })
    const pref = rolePrefs.get(role.id) ?? null
    const rolesPayload = await loadRolesPayload(em, { tenantId: auth.tenantId ?? null, locale })
    return NextResponse.json({
      locale,
      settings: pref
        ? {
            version: pref.version ?? SIDEBAR_PREFERENCES_VERSION,
            groupOrder: pref.groupOrder ?? [],
            groupLabels: pref.groupLabels ?? {},
            itemLabels: pref.itemLabels ?? {},
            hiddenItems: pref.hiddenItems ?? [],
            itemOrder: pref.itemOrder ?? {},
          }
        : emptySettings(),
      canApplyToRoles,
      roles: rolesPayload,
      scope: { type: 'role', roleId: role.id },
    })
  }

  // For API key auth, use userId (the actual user) if available
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  const settings = effectiveUserId
    ? await loadSidebarPreference(em, {
        userId: effectiveUserId,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        locale,
      })
    : null

  const rolesPayload = canApplyToRoles
    ? await loadRolesPayload(em, { tenantId: auth.tenantId ?? null, locale })
    : []

  return NextResponse.json({
    locale,
    settings: {
      version: settings?.version ?? SIDEBAR_PREFERENCES_VERSION,
      groupOrder: settings?.groupOrder ?? [],
      groupLabels: settings?.groupLabels ?? {},
      itemLabels: settings?.itemLabels ?? {},
      hiddenItems: settings?.hiddenItems ?? [],
      itemOrder: settings?.itemOrder ?? {},
    },
    canApplyToRoles,
    roles: rolesPayload,
    scope: { type: 'user' },
  })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // For API key auth, use userId (the actual user) if available
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (!effectiveUserId) {
    return NextResponse.json({ error: 'Cannot save preferences: no user associated with this API key' }, { status: 403 })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = sidebarPreferencesInputSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const sanitizeRecord = (record?: Record<string, string>) => {
    if (!record) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(record)) {
      const trimmedKey = key.trim()
      const trimmedValue = value.trim()
      if (!trimmedKey || !trimmedValue) continue
      result[trimmedKey] = trimmedValue
    }
    return result
  }

  const groupOrderSource = parsed.data.groupOrder ?? []
  const seen = new Set<string>()
  const groupOrder: string[] = []
  for (const id of groupOrderSource) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    groupOrder.push(trimmed)
  }

  const payload = {
    version: parsed.data.version ?? SIDEBAR_PREFERENCES_VERSION,
    groupOrder,
    groupLabels: sanitizeRecord(parsed.data.groupLabels),
    itemLabels: sanitizeRecord(parsed.data.itemLabels),
    hiddenItems: (() => {
      const source = parsed.data.hiddenItems ?? []
      const seenHidden = new Set<string>()
      const values: string[] = []
      for (const href of source) {
        const trimmed = href.trim()
        if (!trimmed || seenHidden.has(trimmed)) continue
        seenHidden.add(trimmed)
        values.push(trimmed)
      }
      return values
    })(),
    itemOrder: (() => {
      const source = parsed.data.itemOrder ?? {}
      const out: Record<string, string[]> = {}
      for (const [groupKey, list] of Object.entries(source)) {
        const trimmedGroup = groupKey.trim()
        if (!trimmedGroup) continue
        const seenItem = new Set<string>()
        const values: string[] = []
        for (const itemKey of list) {
          const trimmedItem = itemKey.trim()
          if (!trimmedItem || seenItem.has(trimmedItem)) continue
          seenItem.add(trimmedItem)
          values.push(trimmedItem)
        }
        if (values.length > 0) out[trimmedGroup] = values
      }
      return out
    })(),
  }

  const { locale } = await resolveTranslations()
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const rbac = container.resolve('rbacService') as any
  const cache = container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<unknown> } | undefined

  const canApplyToRoles = await rbac.userHasAllFeatures?.(
    auth.sub,
    [FEATURE_MANAGE],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ) ?? false

  const scope = parsed.data.scope ?? { type: 'user' as const }

  // Role-scoped write: requires `auth.sidebar.manage` and a role visible to this tenant.
  // applyToRoles/clearRoleIds are forbidden in role scope (validator already rejects them).
  if (scope.type === 'role') {
    if (!canApplyToRoles) {
      return NextResponse.json({ error: 'Forbidden', requiredFeatures: [FEATURE_MANAGE] }, { status: 403 })
    }
    const role = await findRoleInScope(em, { roleId: scope.roleId, tenantId: auth.tenantId ?? null })
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    }
    const saved = await saveRoleSidebarPreference(em, {
      roleId: role.id,
      tenantId: auth.tenantId ?? null,
      locale,
    }, payload)
    if (cache?.deleteByTags) {
      try {
        await cache.deleteByTags([`nav:sidebar:role:${role.id}`])
      } catch {}
    }
    const rolesPayload = await loadRolesPayload(em, { tenantId: auth.tenantId ?? null, locale })
    return NextResponse.json({
      locale,
      settings: {
        version: saved?.version ?? payload.version,
        groupOrder: saved?.groupOrder ?? payload.groupOrder,
        groupLabels: saved?.groupLabels ?? payload.groupLabels,
        itemLabels: saved?.itemLabels ?? payload.itemLabels,
        hiddenItems: saved?.hiddenItems ?? payload.hiddenItems,
        itemOrder: saved?.itemOrder ?? payload.itemOrder,
      },
      canApplyToRoles,
      roles: rolesPayload,
      scope: { type: 'role', roleId: role.id },
      appliedRoles: [],
      clearedRoles: [],
    })
  }

  const applyToRolesSource = parsed.data.applyToRoles ?? []
  const applyToRoles = Array.from(new Set(applyToRolesSource.map((id) => id.trim()).filter((id) => id.length > 0)))
  const clearRoleIdsSource = parsed.data.clearRoleIds ?? []
  const clearRoleIds = Array.from(new Set(clearRoleIdsSource.map((id) => id.trim()).filter((id) => id.length > 0)))

  if ((applyToRoles.length > 0 || clearRoleIds.length > 0) && !canApplyToRoles) {
    return NextResponse.json({ error: 'Forbidden', requiredFeatures: [FEATURE_MANAGE] }, { status: 403 })
  }

  const settings = await saveSidebarPreference(em, {
    userId: effectiveUserId,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  }, payload)

  const roleScope: FilterQuery<Role> = auth.tenantId
    ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
    : { tenantId: null }
  const availableRoles = canApplyToRoles
    ? await findWithDecryption(
        em,
        Role,
        roleScope,
        { orderBy: { name: 'asc' } },
        { tenantId: auth.tenantId ?? null, organizationId: null },
      )
    : []
  const roleMap = new Map<string, Role>(availableRoles.map((role: Role) => [String(role.id), role]))

  const updatedRoleIds: string[] = []
  if (applyToRoles.length > 0) {
    const missing = applyToRoles.filter((id) => !roleMap.has(id))
    if (missing.length) {
      return NextResponse.json({ error: 'Invalid roles', missing }, { status: 400 })
    }
    for (const roleId of applyToRoles) {
      const role = roleMap.get(roleId)!
      await saveRoleSidebarPreference(em, {
        roleId: role.id,
        tenantId: auth.tenantId ?? null,
        locale,
      }, payload)
      updatedRoleIds.push(role.id)
    }
  }

  const filteredClearRoleIds = clearRoleIds.filter((id) => !updatedRoleIds.includes(id) && !applyToRoles.includes(id))

  if (filteredClearRoleIds.length > 0) {
    // Cross-locale: role preferences are unique per (role, tenantId); keep the delete
    // filter aligned with save/load helpers so a clear from one locale does not leave
    // a row created under another locale orphaned.
    await em.nativeDelete(RoleSidebarPreference, {
      role: { $in: filteredClearRoleIds },
      tenantId: auth.tenantId ?? null,
    })
    if (cache?.deleteByTags) {
      try {
        await cache.deleteByTags(filteredClearRoleIds.map((roleId) => `nav:sidebar:role:${roleId}`))
      } catch {}
    }
  }

  if (cache?.deleteByTags) {
    const tags = [
      `nav:sidebar:user:${auth.sub}`,
      `nav:sidebar:scope:${auth.sub}:${auth.tenantId ?? 'null'}:${auth.orgId ?? 'null'}:${locale}`,
      ...updatedRoleIds.map((roleId) => `nav:sidebar:role:${roleId}`),
    ]
    try {
      await cache.deleteByTags(tags)
    } catch {}
  }

  let rolesPayload: Array<{ id: string; name: string; hasPreference: boolean }> = []
  if (canApplyToRoles) {
    const rolePrefs = await loadRoleSidebarPreferences(em, {
      roleIds: availableRoles.map((role: Role) => role.id),
      tenantId: auth.tenantId ?? null,
      locale,
    })
    rolesPayload = availableRoles.map((role: Role) => ({
      id: role.id,
      name: role.name,
      hasPreference: rolePrefs.has(role.id),
    }))
  }

  return NextResponse.json({
    locale,
    settings,
    canApplyToRoles,
    roles: rolesPayload,
    scope: { type: 'user' },
    appliedRoles: updatedRoleIds,
    clearedRoles: filteredClearRoleIds,
  })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const roleIdParam = url.searchParams.get('roleId')
  if (!roleIdParam) {
    return NextResponse.json({ error: 'roleId query parameter is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const rbac = container.resolve('rbacService') as any
  const cache = container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<unknown> } | undefined

  const canApplyToRoles = await rbac.userHasAllFeatures?.(
    auth.sub,
    [FEATURE_MANAGE],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ) ?? false
  if (!canApplyToRoles) {
    return NextResponse.json({ error: 'Forbidden', requiredFeatures: [FEATURE_MANAGE] }, { status: 403 })
  }

  const role = await findRoleInScope(em, { roleId: roleIdParam, tenantId: auth.tenantId ?? null })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  // Cross-locale: keep the delete filter aligned with save/load helpers (no locale).
  await em.nativeDelete(RoleSidebarPreference, {
    role: role.id,
    tenantId: auth.tenantId ?? null,
  })

  if (cache?.deleteByTags) {
    try {
      await cache.deleteByTags([`nav:sidebar:role:${role.id}`])
    } catch {}
  }

  return NextResponse.json({ ok: true, scope: { type: 'role', roleId: role.id } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Sidebar preferences',
  methods: {
    GET: {
      summary: 'Get sidebar preferences',
      description: 'Returns sidebar customization for the current user (default) or the specified role (`?roleId=…`, requires `auth.sidebar.manage`).',
      responses: [
        { status: 200, description: 'Current sidebar configuration', schema: sidebarPreferencesResponseSchema },
        { status: 401, description: 'Unauthorized', schema: sidebarErrorSchema },
        { status: 403, description: 'Missing features for role-scope read', schema: sidebarErrorSchema },
        { status: 404, description: 'Role not found in current tenant scope', schema: sidebarErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update sidebar preferences',
      description: 'Updates sidebar configuration. With `scope.type === "user"` (default) writes the calling user\'s personal preferences and may optionally apply the same settings to selected roles via `applyToRoles[]`. With `scope.type === "role"` writes the named role variant directly (requires `auth.sidebar.manage`); `applyToRoles[]` and `clearRoleIds[]` are rejected in this mode.',
      requestBody: {
        contentType: 'application/json',
        schema: sidebarPreferencesInputSchema,
      },
      responses: [
        { status: 200, description: 'Preferences saved', schema: sidebarPreferencesUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: sidebarErrorSchema },
        { status: 401, description: 'Unauthorized', schema: sidebarErrorSchema },
        { status: 403, description: 'Missing features for role-wide updates', schema: sidebarErrorSchema },
        { status: 404, description: 'Role not found in current tenant scope', schema: sidebarErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete a role sidebar variant',
      description: 'Removes the role variant for the current tenant + locale. Idempotent. Requires `auth.sidebar.manage`.',
      responses: [
        { status: 200, description: 'Variant deleted (or never existed)', schema: sidebarPreferencesDeleteResponseSchema },
        { status: 400, description: 'Missing roleId query parameter', schema: sidebarErrorSchema },
        { status: 401, description: 'Unauthorized', schema: sidebarErrorSchema },
        { status: 403, description: 'Missing features', schema: sidebarErrorSchema },
        { status: 404, description: 'Role not found in current tenant scope', schema: sidebarErrorSchema },
      ],
    },
  },
}
