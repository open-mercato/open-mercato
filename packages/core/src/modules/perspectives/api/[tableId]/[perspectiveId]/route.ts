import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  deleteUserPerspective,
  saveUserPerspective,
} from '@open-mercato/core/modules/perspectives/services/perspectiveService'
import { perspectiveSaveSchema } from '@open-mercato/core/modules/perspectives/data/validators'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { perspectivesTag, perspectivesErrorSchema, perspectivesSuccessSchema, perspectiveSaveResponseSchema } from '../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['perspectives.use'] },
  DELETE: { requireAuth: true, requireFeatures: ['perspectives.use'] },
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

export async function PUT(req: Request, ctx: { params: { tableId: string; perspectiveId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  const perspectiveId = decodeParam(ctx.params?.perspectiveId).trim()
  if (!tableId || !perspectiveId) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

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

  try {
    const saved = await saveUserPerspective(em, cache, {
      scope: {
        userId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      },
      tableId,
      input: { ...parsed.data, perspectiveId },
    })

    return NextResponse.json({ perspective: saved, rolePerspectives: [], clearedRoleIds: [] })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Perspective not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params: { tableId: string; perspectiveId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  const perspectiveId = decodeParam(ctx.params?.perspectiveId).trim()
  if (!tableId || !perspectiveId) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
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

  await deleteUserPerspective(em, cache, {
    scope: {
      userId: auth.sub,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    },
    tableId,
    perspectiveId,
  })

  return NextResponse.json({ success: true })
}

const perspectiveDeletePathParamsSchema = z.object({
  tableId: z.string().min(1),
  perspectiveId: z.string().uuid(),
})

const perspectiveUpdateDoc: OpenApiMethodDoc = {
  summary: 'Update a personal perspective',
  description: 'Updates an existing perspective owned by the current user for the given table.',
  tags: [perspectivesTag],
  requestBody: {
    contentType: 'application/json',
    schema: perspectiveSaveSchema,
    description: 'Updated perspective payload.',
  },
  responses: [
    { status: 200, description: 'Perspective updated successfully.', schema: perspectiveSaveResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: perspectivesErrorSchema },
    { status: 401, description: 'Authentication required', schema: perspectivesErrorSchema },
    { status: 404, description: 'Perspective not found', schema: perspectivesErrorSchema },
  ],
}

const perspectiveDeleteDoc: OpenApiMethodDoc = {
  summary: 'Delete a personal perspective',
  description: 'Removes a perspective owned by the current user for the given table.',
  tags: [perspectivesTag],
  responses: [
    { status: 200, description: 'Perspective removed.', schema: perspectivesSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid identifiers supplied', schema: perspectivesErrorSchema },
    { status: 401, description: 'Authentication required', schema: perspectivesErrorSchema },
    { status: 404, description: 'Perspective not found', schema: perspectivesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: perspectivesTag,
  summary: 'Delete personal perspective',
  pathParams: perspectiveDeletePathParamsSchema,
  methods: {
    PUT: perspectiveUpdateDoc,
    DELETE: perspectiveDeleteDoc,
  },
}
