import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Document,
  DocumentReviewPlaybook,
  DocumentReviewPlaybookReference,
} from '../../../../data/entities'
import {
  reviewPlaybookReferenceCreateSchema,
  reviewPlaybookReferenceDeleteSchema,
} from '../../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../../lib/constants'
import { hasTier, resolvePermission } from '../../../../lib/permissions'
import { DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK } from '../../../../lib/resourceLimits'
import type {
  ReviewPlaybookReferenceCommandResult,
  ReviewPlaybookReferenceCreateCommandInput,
  ReviewPlaybookReferenceDeleteCommandInput,
} from '../../../../commands/reviewPlaybooks'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../../_commands'
import {
  handleDocumentsRouteError,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
  type DocumentsRouteContext,
} from '../../../_shared'

type RouteParams = { params: Promise<{ id: string }> | { id: string } }

const MANAGE_FEATURE = 'documents.review_playbooks.manage'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

const pathParamsSchema = z.object({ id: z.string().uuid() })

const referenceItemSchema = z.object({
  id: z.string().uuid(),
  playbookId: z.string().uuid(),
  documentId: z.string().uuid(),
  title: z.string().nullable(),
  accessible: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
})

const referenceListResponseSchema = z.object({
  items: z.array(referenceItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
})

const referenceMutationResponseSchema = z.object({
  id: z.string().uuid(),
  playbookId: z.string().uuid(),
  documentId: z.string().uuid(),
})

async function resolvePlaybookId(context: RouteParams): Promise<string> {
  const params = await context.params
  const parsed = pathParamsSchema.safeParse(params)
  if (!parsed.success) throw new CrudHttpError(404, { error: 'documents.reviewPlaybooks.errors.notFound' })
  return parsed.data.id
}

async function loadScopedPlaybook(ctx: DocumentsRouteContext, playbookId: string): Promise<DocumentReviewPlaybook> {
  const playbook = await findOneWithDecryption(
    ctx.em,
    DocumentReviewPlaybook,
    { id: playbookId, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!playbook) throw new CrudHttpError(404, { error: 'documents.reviewPlaybooks.errors.notFound' })
  return playbook
}

async function assertCanViewDocument(ctx: DocumentsRouteContext, documentId: string): Promise<void> {
  const tier = await resolvePermission(ctx.em, documentId, ctx.auth)
  if (!hasTier(tier, 'viewer')) throw new CrudHttpError(404, { error: 'documents.documents.notFound' })
}

export async function GET(request: Request, context: RouteParams): Promise<Response> {
  try {
    const playbookId = await resolvePlaybookId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await loadScopedPlaybook(ctx, playbookId)
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const references = await findWithDecryption(
      ctx.em,
      DocumentReviewPlaybookReference,
      { playbookId, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
      { orderBy: { sortOrder: 'ASC', createdAt: 'ASC', id: 'ASC' }, limit: DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK },
      scope,
    )
    const documentIds = references.map((reference) => reference.documentId)
    const documents = documentIds.length > 0
      ? await findWithDecryption(
        ctx.em,
        Document,
        { id: { $in: documentIds }, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
        { fields: ['id', 'title'] },
        scope,
      )
      : []
    const titles = new Map(documents.map((document) => [document.id, document.title]))
    const items = await Promise.all(references.map(async (reference) => {
      const tier = await resolvePermission(ctx.em, reference.documentId, ctx.auth)
      const accessible = hasTier(tier, 'viewer')
      return {
        id: reference.id,
        playbookId: reference.playbookId,
        documentId: reference.documentId,
        title: accessible ? titles.get(reference.documentId) ?? null : null,
        accessible,
        sortOrder: reference.sortOrder,
        createdAt: reference.createdAt.toISOString(),
      }
    }))
    return NextResponse.json({ items, total: items.length, limit: DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.reviewPlaybooks.references.list')
  }
}

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  try {
    const playbookId = await resolvePlaybookId(context)
    const ctx = await resolveDocumentsContext(request, [MANAGE_FEATURE])
    await loadScopedPlaybook(ctx, playbookId)
    const input = reviewPlaybookReferenceCreateSchema.parse(await readBody(request))
    await assertCanViewDocument(ctx, input.documentId)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference,
      resourceId: playbookId,
      operation: 'create',
      mutationPayload: input,
      mutationPayloadSchema: reviewPlaybookReferenceCreateSchema,
    })
    const commandInput: ReviewPlaybookReferenceCreateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      referenceId: randomUUID(),
      playbookId,
      documentId: input.documentId,
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<
      ReviewPlaybookReferenceCreateCommandInput,
      ReviewPlaybookReferenceCommandResult
    >('documents.review_playbook_reference.create', { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference,
      resourceId: playbookId,
      operation: 'create',
    })
    return attachDocumentsOperationMetadata(
      NextResponse.json({
        id: execution.result.id,
        playbookId: execution.result.playbookId,
        documentId: execution.result.documentId,
      }, { status: 201 }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.reviewPlaybooks.references.create')
  }
}

export async function DELETE(request: Request, context: RouteParams): Promise<Response> {
  try {
    const playbookId = await resolvePlaybookId(context)
    const ctx = await resolveDocumentsContext(request, [MANAGE_FEATURE])
    await loadScopedPlaybook(ctx, playbookId)
    const queryDocumentId = new URL(request.url).searchParams.get('documentId')
    const body = queryDocumentId ? { documentId: queryDocumentId } : await readBody(request)
    const input = reviewPlaybookReferenceDeleteSchema.parse(body)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference,
      resourceId: playbookId,
      operation: 'delete',
      mutationPayload: input,
      mutationPayloadSchema: reviewPlaybookReferenceDeleteSchema,
    })
    const commandInput: ReviewPlaybookReferenceDeleteCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      playbookId,
      documentId: input.documentId,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<
      ReviewPlaybookReferenceDeleteCommandInput,
      ReviewPlaybookReferenceCommandResult
    >('documents.review_playbook_reference.delete', { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference,
      resourceId: playbookId,
      operation: 'delete',
    })
    return attachDocumentsOperationMetadata(
      NextResponse.json({
        id: execution.result.id,
        playbookId: execution.result.playbookId,
        documentId: execution.result.documentId,
      }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.reviewPlaybooks.references.delete')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Review playbook guidance documents',
  pathParams: pathParamsSchema,
  methods: {
    GET: {
      summary: 'List guidance documents of a review playbook',
      description: 'Titles are returned only for documents the caller can view.',
      responses: [{ status: 200, description: 'Guidance documents', schema: referenceListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Playbook not found', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Link a guidance document',
      description: 'Links a document the caller can view. A playbook holds at most 20 guidance documents.',
      requestBody: { contentType: 'application/json', schema: reviewPlaybookReferenceCreateSchema },
      responses: [{ status: 201, description: 'Guidance document linked', schema: referenceMutationResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 404, description: 'Playbook or document not found', schema: routeErrorSchema },
        { status: 409, description: 'Document already linked', schema: routeErrorSchema },
        { status: 422, description: 'Guidance document limit reached', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Unlink a guidance document',
      description: 'The document id may be given in the body or as the documentId query parameter.',
      requestBody: { contentType: 'application/json', schema: reviewPlaybookReferenceDeleteSchema },
      responses: [{ status: 200, description: 'Guidance document unlinked', schema: referenceMutationResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 404, description: 'Playbook or link not found', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST, DELETE }
