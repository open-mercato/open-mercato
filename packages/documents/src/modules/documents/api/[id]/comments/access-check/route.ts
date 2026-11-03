import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assertTier, resolveUserAccess } from '../../../../lib/permissions'
import {
  handleDocumentsRouteError,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
  withDocumentsContextErrors,
} from '../../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const accessCheckSchema = z.object({
  userIds: z.array(z.string().uuid()).max(50),
})

const accessCheckResponseSchema = z.object({
  withoutAccess: z.array(z.string().uuid()),
  withoutAccessUsers: z.array(
    z.object({
      userId: z.string().uuid(),
      // Keep the published nullable-string contract for generated clients;
      // this route deliberately returns null values to avoid identity lookup.
      label: z.string().nullable(),
      secondary: z.string().nullable(),
    }),
  ),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.view'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'commenter')
    const input = accessCheckSchema.parse(await readBody(request))
    const uniqueUserIds = Array.from(new Set(input.userIds.map((userId) => userId.toLowerCase())))
    const withoutAccess: string[] = []

    for (const userId of uniqueUserIds) {
      const tier = await resolveUserAccess(
        ctx.em,
        documentId,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        userId,
        ctx.container,
      )
      if (!tier) withoutAccess.push(userId)
    }
    // Keep the historical response shape for clients, but never turn this
    // authorization probe into a user-directory/PII lookup. The caller
    // already supplied these IDs and owns their local mention labels.
    const withoutAccessUsers = withoutAccess.map((userId) => ({
      userId,
      label: null,
      secondary: null,
    }))

    return NextResponse.json({ withoutAccess, withoutAccessUsers })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.accessCheck')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Check mentioned user document access',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Check which mentioned users lack access',
      requestBody: { contentType: 'application/json', schema: accessCheckSchema },
      responses: [{ status: 200, description: 'Mention access check result', schema: accessCheckResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST }
