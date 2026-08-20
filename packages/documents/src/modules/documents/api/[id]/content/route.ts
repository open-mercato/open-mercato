import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { documentContentPutSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { assertTier } from '../../../lib/permissions'
import { loadDocumentContent } from '../../../lib/contentService'
import { assertDocumentContentResourceLimits } from '../../../lib/resourceLimits'
import { DOCUMENTS_JSON_BODY_LIMITS } from '../../../lib/requestBody'
import type {
  ReplaceDocumentContentCommandInput,
  ReplaceDocumentContentCommandResult,
} from '../../../commands/content'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeContent,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'

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
    assertDocumentContentResourceLimits({
      yjsState: content?.yjsState,
      contentHtml: content?.contentHtml,
      contentText: content?.contentText,
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
    await assertDocumentNotArchived(ctx, id)
    const input = documentContentPutSchema.parse(await readBody(
      request,
      DOCUMENTS_JSON_BODY_LIMITS.content,
    ))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: id,
      operation: 'update',
      mutationPayload: input,
      mutationPayloadSchema: documentContentPutSchema,
    })
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const currentContent = await loadDocumentContent(ctx.em, id, scope)
    const commandInput: ReplaceDocumentContentCommandInput = {
      ...input,
      documentId: id,
      contentId: currentContent?.id ?? randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      ReplaceDocumentContentCommandInput,
      ReplaceDocumentContentCommandResult
    >('documents.content.replace', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: id,
      operation: 'update',
    })

    const response = NextResponse.json({ ok: true, updatedAt: result.updatedAt })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.content.put')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
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
        { status: 413, description: 'Stored document content exceeds the safe resource bound', schema: routeErrorSchema },
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
        { status: 409, description: 'Content changed since it was loaded', schema: routeErrorSchema },
        { status: 413, description: 'Document content exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, PUT }
