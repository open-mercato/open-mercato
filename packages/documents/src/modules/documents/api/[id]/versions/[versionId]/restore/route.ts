import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentVersion } from '../../../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../../../lib/constants'
import { loadDocumentContent } from '../../../../../lib/contentService'
import type { RestoreVersionCommandInput } from '../../../../../commands/versions'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../../../_commands'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  resolveActorUserId,
  resolveDocumentCapabilityProjection,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../../../_shared'

type RouteContext = {
  params: Promise<{ id: string; versionId: string }> | { id: string; versionId: string }
}

type RestoreResult = {
  contentHtml: string
  contentText: string
  updatedAt: string
  restoredVersionId: string
  preRestoreVersionId: string
}

const restoreResponseSchema = z.object({
  contentHtml: z.string(),
  contentText: z.string(),
  updatedAt: z.string(),
  restoredVersionId: z.string().uuid(),
  preRestoreVersionId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id: documentId, versionId } = await context.params
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const projection = await resolveDocumentCapabilityProjection(ctx, documentId)
    if (!projection.capabilities.canEdit) throw new CrudHttpError(403, { error: 'Forbidden' })
    await assertDocumentNotArchived(ctx, documentId)

    const targetVersion = await findOneWithDecryption(
      ctx.em,
      DocumentVersion,
      {
        id: versionId,
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (!targetVersion) throw new CrudHttpError(404, { error: 'documents.versions.notFound' })

    // Preserve the existing version-level policy contract. The content-row
    // optimistic lock below is deliberately independent and follows this guard.
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: versionId,
      operation: 'custom',
      mutationPayload: { action: 'restore', documentId, versionId },
    })

    const currentContent = await loadDocumentContent(ctx.em, documentId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    if (!currentContent) throw new CrudHttpError(404, { error: 'documents.content.notFound' })
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: currentContent.id,
      current: currentContent.updatedAt,
      request,
    })

    const restoreEpoch = Math.max(Date.now(), currentContent.updatedAt.getTime() + 1)
    const input: RestoreVersionCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      versionId,
      preRestoreVersionId: randomUUID(),
      actorUserId: resolveActorUserId(ctx.auth),
      expectedContentUpdatedAt: currentContent.updatedAt.toISOString(),
      restoreContentUpdatedAt: new Date(restoreEpoch).toISOString(),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<RestoreVersionCommandInput, RestoreResult>(
      'documents.version.restore',
      { input, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )

    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: versionId,
      operation: 'custom',
    })
    return attachDocumentsOperationMetadata(
      NextResponse.json({
        contentHtml: execution.result.contentHtml,
        contentText: execution.result.contentText,
        updatedAt: execution.result.updatedAt,
        restoredVersionId: execution.result.restoredVersionId,
        preRestoreVersionId: execution.result.preRestoreVersionId,
      }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion, resourceId: versionId },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.versions.restore')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Restore document version',
  pathParams: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Restore and materialize a historical document version',
      responses: [{ status: 200, description: 'Restored document content', schema: restoreResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Version or content not found', schema: routeErrorSchema },
        { status: 409, description: 'Document content changed', schema: routeErrorSchema },
        { status: 422, description: 'Version snapshot is invalid', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST }
