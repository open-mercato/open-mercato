import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { clearRolePerspectives } from '@open-mercato/core/modules/perspectives/services/perspectiveService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { perspectivesTag, perspectivesErrorSchema, perspectivesSuccessSchema } from '../../../openapi'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['perspectives.role_defaults'] },
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

const rolePerspectiveDeleteBodySchema = z.object({
  roleExpectedUpdatedAtByRoleId: z.record(z.string().uuid(), z.string().min(1).nullable()).optional(),
  roleExpectedUpdatedAtByPerspectiveId: z.record(z.string().uuid(), z.string().min(1).nullable()).optional(),
}).optional()

export async function DELETE(req: Request, ctx: { params: { tableId: string; roleId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  const roleId = decodeParam(ctx.params?.roleId).trim()
  if (!tableId || !roleId) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  let parsedBody: z.infer<typeof rolePerspectiveDeleteBodySchema> = undefined
  if (req.body && (req.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const rawBody = await req.text()
      if (rawBody.trim().length > 0) {
        const parsed = rolePerspectiveDeleteBodySchema.safeParse(JSON.parse(rawBody))
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
        }
        parsedBody = parsed.data
      }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
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

  const scope = auth.tenantId
    ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
    : { tenantId: null }

  const role = await em.findOne(Role, { id: roleId, deletedAt: null, ...(scope as any) } as any)
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

  try {
    await clearRolePerspectives(em, cache, {
      tableId,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      roleIds: [roleId],
      expectedUpdatedAtByRoleId: parsedBody?.roleExpectedUpdatedAtByRoleId,
      expectedUpdatedAtByPerspectiveId: parsedBody?.roleExpectedUpdatedAtByPerspectiveId,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  return NextResponse.json({ success: true })
}

const rolePerspectiveDeleteParamsSchema = z.object({
  tableId: z.string().min(1),
  roleId: z.string().uuid(),
})

const rolePerspectiveDeleteDoc: OpenApiMethodDoc = {
  summary: 'Clear role perspectives for a table',
  description: 'Removes all role-level perspectives associated with the provided role identifier for the table.',
  tags: [perspectivesTag],
  requestBody: {
    contentType: 'application/json',
    schema: rolePerspectiveDeleteBodySchema,
    description: 'Optional per-role or per-perspective optimistic-lock tokens.',
  },
  responses: [
    { status: 200, description: 'Role perspectives cleared.', schema: perspectivesSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid identifiers supplied', schema: perspectivesErrorSchema },
    { status: 401, description: 'Authentication required', schema: perspectivesErrorSchema },
    { status: 403, description: 'Missing perspectives.role_defaults feature', schema: perspectivesErrorSchema },
    { status: 409, description: 'Optimistic lock conflict', schema: perspectivesErrorSchema },
    { status: 404, description: 'Role not found in scope', schema: perspectivesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: perspectivesTag,
  summary: 'Delete role-level perspectives',
  pathParams: rolePerspectiveDeleteParamsSchema,
  methods: {
    DELETE: rolePerspectiveDeleteDoc,
  },
}
