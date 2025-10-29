import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@/lib/di/container'
import { sidebarPreferencesInputSchema } from '../../../data/validators'
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
  PUT: { requireAuth: true },
}

const sidebarSettingsSchema = z.object({
  version: z.number().int().positive(),
  groupOrder: z.array(z.string()),
  groupLabels: z.record(z.string(), z.string()),
  itemLabels: z.record(z.string(), z.string()),
  hiddenItems: z.array(z.string()),
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
})

const sidebarPreferencesUpdateResponseSchema = sidebarPreferencesResponseSchema.extend({
  appliedRoles: z.array(z.string().uuid()),
  clearedRoles: z.array(z.string().uuid()),
})

const sidebarErrorSchema = z.object({
  error: z.string(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbac = resolve('rbacService') as any

  const canApplyToRoles = await rbac.userHasAllFeatures?.(
    auth.sub,
    ['auth.sidebar.manage'],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ) ?? false

  const settings = await loadSidebarPreference(em, {
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  })

  let rolesPayload: Array<{ id: string; name: string; hasPreference: boolean }> = []
  if (canApplyToRoles) {
    const roleScope = auth.tenantId
      ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
      : { tenantId: null }
    const roles = await em.find(Role, roleScope as any, { orderBy: { name: 'asc' } })
    const rolePrefs = await loadRoleSidebarPreferences(em, {
      roleIds: roles.map((r: Role) => r.id),
      tenantId: auth.tenantId ?? null,
      locale,
    })
    rolesPayload = roles.map((role: Role) => ({
      id: role.id,
      name: role.name,
      hasPreference: rolePrefs.has(role.id),
    }))
  }

  return NextResponse.json({
    locale,
    settings: {
      version: settings.version ?? SIDEBAR_PREFERENCES_VERSION,
      groupOrder: settings.groupOrder ?? [],
      groupLabels: settings.groupLabels ?? {},
      itemLabels: settings.itemLabels ?? {},
      hiddenItems: settings.hiddenItems ?? [],
    },
    canApplyToRoles,
    roles: rolesPayload,
  })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  }

  const { locale } = await resolveTranslations()
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const rbac = container.resolve('rbacService') as any
  const cache = container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<unknown> } | undefined

  const applyToRolesSource = parsed.data.applyToRoles ?? []
  const applyToRoles = Array.from(new Set(applyToRolesSource.map((id) => id.trim()).filter((id) => id.length > 0)))
  const clearRoleIdsSource = parsed.data.clearRoleIds ?? []
  const clearRoleIds = Array.from(new Set(clearRoleIdsSource.map((id) => id.trim()).filter((id) => id.length > 0)))

  const canApplyToRoles = await rbac.userHasAllFeatures?.(
    auth.sub,
    ['auth.sidebar.manage'],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ) ?? false

  if ((applyToRoles.length > 0 || clearRoleIds.length > 0) && !canApplyToRoles) {
    return NextResponse.json({ error: 'Forbidden', requiredFeatures: ['auth.sidebar.manage'] }, { status: 403 })
  }

  const settings = await saveSidebarPreference(em, {
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  }, payload)

  const roleScope = auth.tenantId
    ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
    : { tenantId: null }
  const availableRoles = canApplyToRoles
    ? await em.find(Role, roleScope as any, { orderBy: { name: 'asc' } })
    : []
  const roleMap = new Map(availableRoles.map((role: Role) => [role.id, role]))

  let updatedRoleIds: string[] = []
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
    await em.nativeDelete(RoleSidebarPreference, {
      role: { $in: filteredClearRoleIds },
      locale,
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
    appliedRoles: updatedRoleIds,
    clearedRoles: filteredClearRoleIds,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Sidebar preferences',
  methods: {
    GET: {
      summary: 'Get sidebar preferences',
      description: 'Returns personal sidebar customization and any role-level preferences the user can manage.',
      responses: [
        { status: 200, description: 'Current sidebar configuration', schema: sidebarPreferencesResponseSchema },
        { status: 401, description: 'Unauthorized', schema: sidebarErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update sidebar preferences',
      description: 'Updates personal sidebar configuration and, optionally, applies the same settings to selected roles.',
      requestBody: {
        contentType: 'application/json',
        schema: sidebarPreferencesInputSchema,
      },
      responses: [
        { status: 200, description: 'Preferences saved', schema: sidebarPreferencesUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: sidebarErrorSchema },
        { status: 401, description: 'Unauthorized', schema: sidebarErrorSchema },
        { status: 403, description: 'Missing features for role-wide updates', schema: sidebarErrorSchema },
      ],
    },
  },
}
