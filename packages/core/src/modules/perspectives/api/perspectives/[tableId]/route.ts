import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { perspectiveSaveSchema } from '@open-mercato/core/modules/perspectives/data/validators'
import {
  loadPerspectivesState,
  saveUserPerspective,
  saveRolePerspectives,
  clearRolePerspectives,
  type PerspectiveScope,
} from '@open-mercato/core/modules/perspectives/services/perspectiveService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['perspectives.save'] },
}

const decodeParam = (value: string | string[] | undefined): string => {
  if (!value) return ''
  const raw = Array.isArray(value) ? value[0] : value
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function buildScope(auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>): PerspectiveScope {
  return {
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }
}

export async function GET(_req: Request, ctx: { params: { tableId: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  if (!tableId) return NextResponse.json({ error: 'Invalid table id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const cache = ((): import('@open-mercato/cache').CacheStrategy | null => {
    try {
      return container.resolve('cache') as import('@open-mercato/cache').CacheStrategy
    } catch {
      return null
    }
  })()
  const rbac = container.resolve('rbacService') as {
    userHasAllFeatures?: (
      userId: string,
      features: string[],
      scope: { tenantId: string | null; organizationId: string | null },
    ) => Promise<boolean>
  }

  const assignedRoleNames = Array.isArray(auth.roles)
    ? Array.from(new Set(auth.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)))
    : []
  const assignedRoles = assignedRoleNames.length
    ? await em.find(Role, {
        name: { $in: assignedRoleNames as any },
        deletedAt: null,
      } as any, { orderBy: { name: 'asc' } })
    : []
  const assignedRoleIds = assignedRoles.map((role) => role.id)

  const canApplyToRoles = await rbac.userHasAllFeatures?.(
    auth.sub,
    ['perspectives.role_defaults'],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ) ?? false

  const roleScope = auth.tenantId
    ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
    : { tenantId: null }
  const availableRoles = canApplyToRoles
    ? await em.find(Role, { ...roleScope as any, deletedAt: null } as any, { orderBy: { name: 'asc' } })
    : assignedRoles

  const state = await loadPerspectivesState(em, cache, {
    scope: buildScope(auth),
    tableId,
    roleIds: assignedRoleIds,
  })

  const rolePerspectiveByRole = new Map<string, { hasDefault: boolean; count: number }>()
  for (const item of state.rolePerspectives) {
    const entry = rolePerspectiveByRole.get(item.roleId) ?? { hasDefault: false, count: 0 }
    entry.count += 1
    entry.hasDefault = entry.hasDefault || item.isDefault
    rolePerspectiveByRole.set(item.roleId, entry)
  }

  return NextResponse.json({
    tableId,
    perspectives: state.personal,
    defaultPerspectiveId: state.personalDefaultId,
    rolePerspectives: state.rolePerspectives.map((rp) => ({
      ...rp,
      roleName: availableRoles.find((role) => role.id === rp.roleId)?.name ?? assignedRoles.find((role) => role.id === rp.roleId)?.name ?? null,
    })),
    roles: availableRoles.map((role) => {
      const stats = rolePerspectiveByRole.get(role.id)
      return {
        id: role.id,
        name: role.name,
        hasPerspective: Boolean(stats?.count),
        hasDefault: Boolean(stats?.hasDefault),
      }
    }),
    canApplyToRoles,
  })
}

export async function POST(req: Request, ctx: { params: { tableId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  if (!tableId) return NextResponse.json({ error: 'Invalid table id' }, { status: 400 })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = perspectiveSaveSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const cache = ((): import('@open-mercato/cache').CacheStrategy | null => {
    try {
      return container.resolve('cache') as import('@open-mercato/cache').CacheStrategy
    } catch {
      return null
    }
  })()
  const rbac = container.resolve('rbacService') as {
    userHasAllFeatures?: (
      userId: string,
      features: string[],
      scope: { tenantId: string | null; organizationId: string | null },
    ) => Promise<boolean>
  }

  const scope = buildScope(auth)
  const saved = await saveUserPerspective(em, cache, {
    scope,
    tableId,
    input: parsed.data,
  })

  const applyToRoles = Array.from(new Set(parsed.data.applyToRoles ?? [])).filter((id) => id.trim().length > 0)
  const clearRoleIds = Array.from(new Set(parsed.data.clearRoleIds ?? [])).filter((id) => id.trim().length > 0)
  let updatedRolePerspectives: Awaited<ReturnType<typeof saveRolePerspectives>> | null = null

  if (applyToRoles.length > 0 || clearRoleIds.length > 0) {
    const canApplyToRoles = await rbac.userHasAllFeatures?.(
      auth.sub,
      ['perspectives.role_defaults'],
      { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
    ) ?? false

    if (!canApplyToRoles) {
      return NextResponse.json({ error: 'Forbidden', requiredFeatures: ['perspectives.role_defaults'] }, { status: 403 })
    }

    const roleScope = auth.tenantId
      ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
      : { tenantId: null }
    const targetRoleIds = Array.from(new Set([...applyToRoles, ...clearRoleIds]))
    const roles = await em.find(Role, {
      id: { $in: targetRoleIds as any },
      ...(roleScope as any),
      deletedAt: null,
    } as any)
    const validRoleIds = new Set(roles.map((role) => role.id))

    const missing = targetRoleIds.filter((id) => !validRoleIds.has(id))
    if (missing.length) {
      return NextResponse.json({ error: 'Invalid roles', missing }, { status: 400 })
    }

    if (applyToRoles.length) {
      updatedRolePerspectives = await saveRolePerspectives(em, cache, {
        tableId,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        input: {
          roleIds: applyToRoles,
          name: parsed.data.name,
          settings: parsed.data.settings,
          setDefault: parsed.data.setRoleDefault ?? false,
        },
      })
    }

    if (clearRoleIds.length) {
      await clearRolePerspectives(em, cache, {
        tableId,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        roleIds: clearRoleIds,
      })
    }
  }

  return NextResponse.json({
    perspective: saved,
    rolePerspectives: updatedRolePerspectives ?? [],
    clearedRoleIds: clearRoleIds ?? [],
  })
}
