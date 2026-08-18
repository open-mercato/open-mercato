import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import type { FavoriteCommandInput, FavoriteCommandResult } from '../../../commands/favorites'
import {
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import {
  handleDocumentsRouteError,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  type DocumentsRouteContext,
  withDocumentsContextErrors,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const toggleResponseSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['documents.view'] },
}

async function runFavoriteToggle(
  request: Request,
  context: RouteContext,
  commandId: 'documents.favorite.create' | 'documents.favorite.delete',
  operation: 'create' | 'delete',
  errorScope: string,
): Promise<Response> {
  try {
    const { id: documentId } = await context.params
    const ctx: DocumentsRouteContext = await resolveDocumentsContext(request, ['documents.view'])
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFavorite,
      resourceId: documentId,
      operation,
      mutationPayload: { documentId },
    })

    const input: FavoriteCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      favoriteId: randomUUID(),
      actorUserId: resolveActorUserId(ctx.auth),
    }
    const commandBus: CommandBus = resolveDocumentsCommandBus(ctx)
    const { result } = await commandBus.execute<FavoriteCommandInput, FavoriteCommandResult>(
      commandId,
      { input, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFavorite,
      resourceId: documentId,
      operation,
    })
    return NextResponse.json({ id: result.id, active: result.active })
  } catch (error) {
    return handleDocumentsRouteError(error, errorScope)
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return runFavoriteToggle(request, context, 'documents.favorite.create', 'create', 'documents.favorite.create')
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return runFavoriteToggle(request, context, 'documents.favorite.delete', 'delete', 'documents.favorite.delete')
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document favorite toggle',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Star a document for the current user',
      responses: [{ status: 200, description: 'Favorite state', schema: toggleResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Remove the current user star from a document',
      responses: [{ status: 200, description: 'Favorite state', schema: toggleResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST, DELETE }
