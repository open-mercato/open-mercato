import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { DocumentContent } from '../../data/entities'
import { documentUpdateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import { emitDocumentsEvent } from '../../events'
import { assertTier } from '../../lib/permissions'
import {
  handleDocumentsRouteError,
  loadScopedDocument,
  loadScopedFolder,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  resolveSearchIndexer,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeDocument,
  validateMutationGuard,
} from '../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const detailResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  folderId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tier: z.enum(['owner', 'editor', 'commenter', 'viewer']),
  canShare: z.boolean(),
})

const mutationResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})

const deleteResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['documents.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['documents.delete'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const tier = await assertTier(ctx.em, id, ctx.auth, 'viewer')
    const document = await loadScopedDocument(ctx, id)
    return NextResponse.json({ ...serializeDocument(document), tier, canShare: tier === 'owner' })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.detail')
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, id, ctx.auth, 'editor')
    const document = await loadScopedDocument(ctx, id)
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      current: document.updatedAt,
      request,
    })

    const body = await readBody(request)
    const input = documentUpdateSchema.parse({ ...body, id })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'update',
      mutationPayload: input,
    })

    if (input.folderId) {
      await loadScopedFolder(ctx, input.folderId)
    }

    if (input.title !== undefined) document.title = input.title
    if (Object.prototype.hasOwnProperty.call(input, 'folderId')) {
      document.folderId = input.folderId ?? null
    }
    document.updatedAt = new Date()
    await ctx.em.flush()

    await resolveSearchIndexer(ctx.container).indexRecordById({
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: id,
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
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'update',
    })

    return NextResponse.json({ id, updatedAt: document.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.update')
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.delete'])
    await assertTier(ctx.em, id, ctx.auth, 'owner')
    const document = await loadScopedDocument(ctx, id)
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      current: document.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'delete',
    })

    const content = await ctx.em.findOne(DocumentContent, {
      documentId: id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })
    const now = new Date()
    document.deletedAt = now
    document.updatedAt = now
    document.isActive = false
    if (content) {
      content.deletedAt = now
      content.updatedAt = now
    }
    await ctx.em.flush()

    const searchIndexer = resolveSearchIndexer(ctx.container)
    if (typeof searchIndexer.deleteRecord === 'function') {
      await searchIndexer.deleteRecord({
        entityId: DOCUMENTS_ENTITY_IDS.document,
        recordId: id,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    }
    await emitDocumentsEvent('documents.document.deleted', {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: resolveActorUserId(ctx.auth),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'delete',
    })

    return NextResponse.json({ ok: true, id, updatedAt: document.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document detail',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get document metadata',
      responses: [{ status: 200, description: 'Document metadata', schema: detailResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Not found', schema: routeErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update document metadata',
      requestBody: { contentType: 'application/json', schema: documentUpdateSchema },
      responses: [{ status: 200, description: 'Document updated', schema: mutationResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete document',
      responses: [{ status: 200, description: 'Document deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Not found', schema: routeErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET, PUT, DELETE }
