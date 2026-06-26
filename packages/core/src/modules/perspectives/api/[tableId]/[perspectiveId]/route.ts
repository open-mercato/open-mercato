import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { deleteUserPerspective } from '@open-mercato/core/modules/perspectives/services/perspectiveService'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { perspectivesTag, perspectivesErrorSchema, perspectivesSuccessSchema } from '../../openapi'

export const metadata = {
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

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId ?? '',
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    resourceKind: 'perspectives.perspective',
    resourceId: perspectiveId,
    operation: 'delete',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { tableId, perspectiveId },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  let deleted = false
  try {
    deleted = await deleteUserPerspective(em, cache, {
      scope: {
        userId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      },
      tableId,
      perspectiveId,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  if (deleted && guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId ?? '',
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      resourceKind: 'perspectives.perspective',
      resourceId: perspectiveId,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json({ success: true })
}

const perspectiveDeletePathParamsSchema = z.object({
  tableId: z.string().min(1),
  perspectiveId: z.string().uuid(),
})

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
    { status: 409, description: 'Optimistic lock conflict', schema: perspectivesErrorSchema },
    { status: 404, description: 'Perspective not found', schema: perspectivesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: perspectivesTag,
  summary: 'Delete personal perspective',
  pathParams: perspectiveDeletePathParamsSchema,
  methods: {
    DELETE: perspectiveDeleteDoc,
  },
}
