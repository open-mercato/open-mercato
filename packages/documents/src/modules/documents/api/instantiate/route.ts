import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { documentTemplateInstantiateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import { dedupeTemplateLinkSlots } from '../../lib/templateInstantiation'
import { DOCUMENTS_JSON_BODY_LIMITS } from '../../lib/requestBody'
import {
  handleDocumentsRouteError,
  hasDocumentsFeature,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../_commands'
import type { InstantiateDocumentCommandInput } from '../../commands/documents'

const instantiateResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
  links: z.array(z.object({
    id: z.string().uuid(),
    entityType: z.string(),
    label: z.string(),
    href: z.string(),
  })),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.create', 'documents.edit'] },
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.create', 'documents.edit'])
    if (
      !hasDocumentsFeature(ctx.auth, 'documents.create')
      || !hasDocumentsFeature(ctx.auth, 'documents.edit')
    ) {
      throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
    }
    const input = documentTemplateInstantiateSchema.parse(await readBody(
      request,
      DOCUMENTS_JSON_BODY_LIMITS.templateRender,
    ))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: input,
      mutationPayloadSchema: documentTemplateInstantiateSchema,
    })
    const commandInput: InstantiateDocumentCommandInput = {
      ...input,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId: randomUUID(),
      contentId: randomUUID(),
      linkIds: dedupeTemplateLinkSlots(input.slots).map(() => randomUUID()),
      createdByUserId: resolveActorUserId(ctx.auth),
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      InstantiateDocumentCommandInput,
      z.infer<typeof instantiateResponseSchema>
    >('documents.document.instantiate', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
    })
    const response = NextResponse.json(result, { status: 201 })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.instantiate')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Instantiate a document from a contextual template',
  methods: {
    POST: {
      summary: 'Atomically create document metadata, content, and entity links',
      requestBody: { contentType: 'application/json', schema: documentTemplateInstantiateSchema },
      responses: [{ status: 201, description: 'Document instantiated', schema: instantiateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Template or folder not found', schema: routeErrorSchema },
        { status: 409, description: 'Preview or template revision changed', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
        { status: 503, description: 'Target lookup unavailable', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST }
