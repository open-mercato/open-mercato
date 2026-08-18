import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DOCUMENTS_ENTITY_IDS } from '../../../../lib/constants'
import { assertTier } from '../../../../lib/permissions'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../../_commands'
import type { LinkDeleteCommandInput } from '../../../../commands/links'

type RouteContext = {
  params: Promise<{ id: string; linkId: string }> | { id: string; linkId: string }
}

const deleteResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  updatedAt: z.string(),
})

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, params.id, ctx.auth, 'editor')
    await assertDocumentNotArchived(ctx, params.id)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: params.linkId,
      operation: 'delete',
    })
    const input: LinkDeleteCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId: params.id,
      linkId: params.linkId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      LinkDeleteCommandInput,
      { id: string; updatedAt: string }
    >('documents.link.delete', {
      input,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: params.linkId,
      operation: 'delete',
    })
    const response = NextResponse.json({ ok: true, ...result })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: params.linkId,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.links.delete')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Delete a document entity link',
  pathParams: z.object({ id: z.string().uuid(), linkId: z.string().uuid() }),
  methods: {
    DELETE: {
      summary: 'Soft-delete a document entity link',
      responses: [{ status: 200, description: 'Link deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Link not found', schema: routeErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
      ],
    },
  },
})

export default { DELETE }
