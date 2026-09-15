import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Document } from '../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import type { DocumentLifecycleCommandInput, DocumentLifecycleCommandResult } from '../../../commands/lifecycle'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import {
  handleDocumentsRouteError,
  resolveActorUserId,
  resolveDocumentCapabilityProjection,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const lifecycleResponseSchema = z.object({
  id: z.string().uuid(),
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function runDocumentLifecycleRoute(
  request: Request,
  context: RouteContext,
  commandId: 'documents.document.archive' | 'documents.document.unarchive',
  errorScope: string,
): Promise<Response> {
  try {
    const { id: documentId } = await context.params
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const projection = await resolveDocumentCapabilityProjection(ctx, documentId)
    if (!projection.capabilities.canArchive) throw new CrudHttpError(403, { error: 'Forbidden' })

    const document = await findOneWithDecryption(
      ctx.em,
      Document,
      {
        id: documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { fields: ['id', 'archivedAt', 'updatedAt'] },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (!document) throw new CrudHttpError(404, { error: 'documents.documents.notFound' })
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: documentId,
      current: document.updatedAt,
      request,
    })

    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: documentId,
      operation: 'update',
      mutationPayload: { action: commandId === 'documents.document.archive' ? 'archive' : 'unarchive' },
    })

    const input: DocumentLifecycleCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: document.updatedAt.toISOString(),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<
      DocumentLifecycleCommandInput,
      DocumentLifecycleCommandResult
    >(commandId, { input, ctx: buildDocumentsCommandRuntimeContext(ctx) })

    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: documentId,
      operation: 'update',
    })
    return attachDocumentsOperationMetadata(
      NextResponse.json({
        id: execution.result.id,
        archivedAt: execution.result.archivedAt,
        updatedAt: execution.result.updatedAt,
      }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.document, resourceId: documentId },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, errorScope)
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return runDocumentLifecycleRoute(request, context, 'documents.document.archive', 'documents.archive')
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Archive document',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Archive a document, making it read-only and hidden from default listings',
      responses: [{ status: 200, description: 'Archived document state', schema: lifecycleResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
        { status: 409, description: 'Document changed concurrently', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST }
