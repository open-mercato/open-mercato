import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { isCrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { perspectiveSaveSchema } from '@open-mercato/core/modules/perspectives/data/validators'
import {
  loadPerspectivesState,
  saveUserPerspective,
  saveRolePerspectives,
  clearRolePerspectives,
  type PerspectiveScope,
} from '@open-mercato/core/modules/perspectives/services/perspectiveService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  perspectivesTag,
  perspectivesErrorSchema,
  perspectivesIndexResponseSchema,
  perspectiveSaveResponseSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['perspectives.use'] },
  POST: { requireAuth: true, requireFeatures: ['perspectives.use'] },
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
  const assignedRoles = assignedRoleNames.length && auth.tenantId
    ? await em.find(Role, {
        name: { $in: assignedRoleNames as any },
        tenantId: auth.tenantId,
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

  const applyToRoles = Array.from(new Set(parsed.data.applyToRoles ?? [])).filter((id) => id.trim().length > 0)
  const clearRoleIds = Array.from(new Set(parsed.data.clearRoleIds ?? [])).filter((id) => id.trim().length > 0)
  const hasRoleOps = applyToRoles.length > 0 || clearRoleIds.length > 0
  const targetRoleIds = Array.from(new Set([...applyToRoles, ...clearRoleIds]))

  if (hasRoleOps) {
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
  }

  const guardResourceId = parsed.data.perspectiveId ?? tableId
  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId ?? '',
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    resourceKind: 'perspectives.perspective',
    resourceId: guardResourceId,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { ...parsed.data, tableId },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  let roleGuardResult: Awaited<ReturnType<typeof validateCrudMutationGuard>> | null = null
  if (hasRoleOps) {
    roleGuardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId ?? '',
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      resourceKind: 'perspectives.role_perspective',
      resourceId: targetRoleIds.join(','),
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: {
        tableId,
        applyToRoles,
        clearRoleIds,
        name: parsed.data.name,
        settings: parsed.data.settings,
        setRoleDefault: parsed.data.setRoleDefault ?? false,
      },
    })
  }
  if (roleGuardResult && !roleGuardResult.ok) {
    return NextResponse.json(roleGuardResult.body, { status: roleGuardResult.status })
  }

  let saved: Awaited<ReturnType<typeof saveUserPerspective>> | null = null
  let updatedRolePerspectives: Awaited<ReturnType<typeof saveRolePerspectives>> | null = null
  let clearedRolePerspectiveCount = 0

  try {
    await withAtomicFlush(em, [
      async () => {
        saved = await saveUserPerspective(em, cache, {
          scope,
          tableId,
          input: parsed.data,
          request: req,
        })
      },
      async () => {
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
      },
      async () => {
        if (clearRoleIds.length) {
          clearedRolePerspectiveCount = await clearRolePerspectives(em, cache, {
            tableId,
            tenantId: auth.tenantId ?? null,
            organizationId: auth.orgId ?? null,
            roleIds: clearRoleIds,
          })
        }
      },
    ], { transaction: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json({
        error: 'A view with this name already exists.',
        code: 'duplicate_name',
      }, { status: 409 })
    }
    throw err
  }

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId ?? '',
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      resourceKind: 'perspectives.perspective',
      resourceId: guardResourceId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  const didWriteRolePerspectives = applyToRoles.length > 0 || clearedRolePerspectiveCount > 0
  if (didWriteRolePerspectives && roleGuardResult?.ok && roleGuardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId ?? '',
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      resourceKind: 'perspectives.role_perspective',
      resourceId: targetRoleIds.join(','),
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: roleGuardResult.metadata ?? null,
    })
  }

  return NextResponse.json({
    perspective: saved,
    rolePerspectives: updatedRolePerspectives ?? [],
    clearedRoleIds: clearRoleIds ?? [],
  })
}

const perspectivePathParamsSchema = z.object({
  tableId: z.string().min(1),
})

const perspectivesGetDoc: OpenApiMethodDoc = {
  summary: 'Load perspectives for a table',
  description: 'Returns personal perspectives and available role defaults for the requested table identifier.',
  tags: [perspectivesTag],
  responses: [
    { status: 200, description: 'Current perspectives and defaults.', schema: perspectivesIndexResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid table identifier', schema: perspectivesErrorSchema },
    { status: 401, description: 'Authentication required', schema: perspectivesErrorSchema },
  ],
}

const perspectivesPostDoc: OpenApiMethodDoc = {
  summary: 'Create or update a perspective',
  description: 'Saves a personal perspective and optionally applies the same configuration to selected roles.',
  tags: [perspectivesTag],
  requestBody: {
    contentType: 'application/json',
    schema: perspectiveSaveSchema,
    description: 'Perspective payload including optional role defaults.',
  },
  responses: [
    { status: 200, description: 'Perspective saved successfully.', schema: perspectiveSaveResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed or invalid roles provided', schema: perspectivesErrorSchema },
    { status: 401, description: 'Authentication required', schema: perspectivesErrorSchema },
    { status: 403, description: 'Missing perspectives.role_defaults feature for role updates', schema: perspectivesErrorSchema },
    { status: 409, description: 'Perspective name already exists', schema: perspectivesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: perspectivesTag,
  summary: 'Manage table perspectives',
  pathParams: perspectivePathParamsSchema,
  methods: {
    GET: perspectivesGetDoc,
    POST: perspectivesPostDoc,
  },
}
