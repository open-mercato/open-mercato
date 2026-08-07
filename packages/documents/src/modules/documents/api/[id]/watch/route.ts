import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import type { WatchCommandInput, WatchCommandResult } from '../../../commands/watchers'
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

async function runWatchToggle(
  request: Request,
  context: RouteContext,
  commandId: 'documents.watch.create' | 'documents.watch.delete',
  operation: 'create' | 'delete',
  errorScope: string,
): Promise<Response> {
  try {
    const { id: documentId } = await context.params
    const ctx: DocumentsRouteContext = await resolveDocumentsContext(request, ['documents.view'])
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentWatcher,
      resourceId: documentId,
      operation,
      mutationPayload: { documentId },
    })

    const input: WatchCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      watcherId: randomUUID(),
      actorUserId: resolveActorUserId(ctx.auth),
    }
    const commandBus: CommandBus = resolveDocumentsCommandBus(ctx)
    const { result } = await commandBus.execute<WatchCommandInput, WatchCommandResult>(
      commandId,
      { input, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentWatcher,
      resourceId: documentId,
      operation,
    })
    return NextResponse.json({ id: result.id, active: result.active })
  } catch (error) {
    return handleDocumentsRouteError(error, errorScope)
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return runWatchToggle(request, context, 'documents.watch.create', 'create', 'documents.watch.create')
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return runWatchToggle(request, context, 'documents.watch.delete', 'delete', 'documents.watch.delete')
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document watch toggle',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Watch a document for activity notifications',
      responses: [{ status: 200, description: 'Watch state', schema: toggleResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
        { status: 422, description: 'Watcher limit reached', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Stop watching a document (allowed even after access loss)',
      responses: [{ status: 200, description: 'Watch state', schema: toggleResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
  },
}

export default { POST, DELETE }
