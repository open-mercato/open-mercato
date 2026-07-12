import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { documentUpdateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import {
  handleDocumentsRouteError,
  loadScopedDocument,
  readBody,
  resolveDocumentCapabilityProjection,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeDocument,
  validateMutationGuard,
} from '../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../_commands'
import type {
  DocumentDeleteCommandInput,
  DocumentUpdateCommandInput,
} from '../../commands/document-crud'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const capabilitiesSchema = z.object({
  canView: z.boolean(),
  canComment: z.boolean(),
  canEdit: z.boolean(),
  canShare: z.boolean(),
  canDelete: z.boolean(),
  canCreate: z.boolean(),
  canManageTemplates: z.boolean(),
})

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
  capabilities: capabilitiesSchema,
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
    const projection = await resolveDocumentCapabilityProjection(ctx, id)
    if (!projection.relationshipTier || !projection.capabilities.canView) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const document = await loadScopedDocument(ctx, id)
    return NextResponse.json({
      ...serializeDocument(document),
      tier: projection.relationshipTier,
      canShare: projection.capabilities.canShare,
      capabilities: projection.capabilities,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.detail')
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const projection = await resolveDocumentCapabilityProjection(ctx, id)
    if (!projection.capabilities.canEdit) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const body = await readBody(request)
    const input = documentUpdateSchema.parse({ ...body, id })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'update',
      mutationPayload: input,
    })

    const commandInput: DocumentUpdateCommandInput = {
      ...input,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      DocumentUpdateCommandInput,
      { id: string; updatedAt: string }
    >('documents.document.update', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'update',
    })

    const response = NextResponse.json({ id: result.id, updatedAt: result.updatedAt })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.update')
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.delete'])
    const projection = await resolveDocumentCapabilityProjection(ctx, id)
    if (!projection.capabilities.canDelete) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'delete',
    })

    const commandInput: DocumentDeleteCommandInput = {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      DocumentDeleteCommandInput,
      { id: string; updatedAt: string }
    >('documents.document.delete', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: id,
      operation: 'delete',
    })

    const response = NextResponse.json({ ok: true, id: result.id, updatedAt: result.updatedAt })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
    })
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
      description: 'Permanently releases every document-owned attachment and schedules reference-checked provider cleanup before soft-deleting the document record. Because attachment bytes are removed, this operation is intentionally not undoable.',
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
