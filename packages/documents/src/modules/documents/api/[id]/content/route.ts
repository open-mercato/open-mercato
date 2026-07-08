import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { documentContentPutSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { emitDocumentsEvent } from '../../../events'
import { assertTier } from '../../../lib/permissions'
import { loadDocumentContent, persistDocumentContent } from '../../../lib/contentService'
import {
  handleDocumentsRouteError,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  resolveSearchIndexer,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeContent,
  validateMutationGuard,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const contentResponseSchema = z.object({
  contentHtml: z.string(),
  contentText: z.string(),
  updatedAt: z.string().nullable(),
})

const contentPutResponseSchema = z.object({
  ok: z.boolean(),
  updatedAt: z.string().nullable(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, id, ctx.auth, 'viewer')
    const content = await loadDocumentContent(ctx.em, id, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    return NextResponse.json(serializeContent(content))
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.content.get')
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, id, ctx.auth, 'editor')
    const input = documentContentPutSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: id,
      operation: 'update',
      mutationPayload: input,
    })

    await persistDocumentContent(
      ctx.em,
      id,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      {
        contentHtml: input.contentHtml,
        contentText: input.contentText ?? '',
      },
      { searchIndexer: resolveSearchIndexer(ctx.container) },
    )
    const content = await loadDocumentContent(ctx.em, id, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    await emitDocumentsEvent('documents.document.updated', {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: resolveActorUserId(ctx.auth),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: id,
      operation: 'update',
    })

    return NextResponse.json({ ok: true, updatedAt: content?.updatedAt ? content.updatedAt.toISOString() : null })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.content.put')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document content',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get document content',
      responses: [{ status: 200, description: 'Document content', schema: contentResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Not found', schema: routeErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update document content',
      requestBody: { contentType: 'application/json', schema: documentContentPutSchema },
      responses: [{ status: 200, description: 'Content persisted', schema: contentPutResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET, PUT }
