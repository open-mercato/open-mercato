import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentFinding } from '../../../data/entities'
import { findingIngestSchema, findingListQuerySchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  loadReviewPlaybookInfo,
  resolveLatestReview,
  serializeDocumentFinding,
} from '../../../lib/findingSummary'
import { DOCUMENTS_JSON_BODY_LIMITS } from '../../../lib/requestBody'
import type {
  FindingIngestCommandInput,
  FindingIngestCommandResult,
} from '../../../commands/findings'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import {
  assertFindingsAccess,
  findingPathParamsSchema,
  findingResponseSchema,
  resolveFindingRouteParams,
  reviewPlaybookInfoSchema,
  type FindingRouteParams,
} from '../../_findings'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../_shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

const findingListResponseSchema = z.object({
  items: z.array(findingResponseSchema),
  total: z.number().int().nonnegative(),
  reviewId: z.string().uuid().nullable(),
  playbook: reviewPlaybookInfoSchema.nullable(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})

const findingIngestResponseSchema = z.object({
  reviewId: z.string().uuid(),
  created: z.number().int().nonnegative(),
  superseded: z.number().int().nonnegative(),
  unlocated: z.number().int().nonnegative(),
})

export async function GET(request: Request, context: FindingRouteParams): Promise<Response> {
  try {
    const { documentId } = await resolveFindingRouteParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertFindingsAccess(ctx, documentId)
    const url = new URL(request.url)
    const query = findingListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const reviewId = query.reviewId ?? (await resolveLatestReview(ctx.em, scope, documentId))?.reviewId ?? null
    if (!reviewId) {
      return NextResponse.json({ items: [], total: 0, reviewId: null, playbook: null, page: query.page, pageSize: query.pageSize })
    }
    const where: FilterQuery<DocumentFinding> = {
      documentId,
      reviewId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    }
    const findings = await findWithDecryption(
      ctx.em,
      DocumentFinding,
      where,
      {
        orderBy: { createdAt: 'ASC', id: 'ASC' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
      scope,
    )
    const total = await ctx.em.count(DocumentFinding, where)
    const playbook = await loadReviewPlaybookInfo(ctx.em, scope, documentId, reviewId)
    return NextResponse.json({
      items: findings.map(serializeDocumentFinding),
      total,
      reviewId,
      playbook,
      page: query.page,
      pageSize: query.pageSize,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.findings.list')
  }
}

export async function POST(request: Request, context: FindingRouteParams): Promise<Response> {
  try {
    const { documentId } = await resolveFindingRouteParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertFindingsAccess(ctx, documentId)
    await assertDocumentNotArchived(ctx, documentId)
    const input = findingIngestSchema.parse(await readBody(request, DOCUMENTS_JSON_BODY_LIMITS.findingIngest))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: input,
      mutationPayloadSchema: findingIngestSchema,
    })
    const commandInput: FindingIngestCommandInput = {
      ...input,
      documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<FindingIngestCommandInput, FindingIngestCommandResult>(
      'documents.finding.ingest',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
      resourceId: documentId,
      operation: 'create',
    })
    return attachDocumentsOperationMetadata(
      NextResponse.json({
        reviewId: execution.result.reviewId,
        created: execution.result.created,
        superseded: execution.result.superseded,
        unlocated: execution.result.unlocated,
      }, { status: 201 }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding, resourceId: execution.result.reviewId },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.findings.ingest')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document review findings',
  pathParams: findingPathParamsSchema,
  methods: {
    GET: {
      summary: 'List review findings',
      description: 'Lists findings of one review (default: the latest review). Requires the editor tier on the document; lower tiers receive 404.',
      query: findingListQuerySchema,
      responses: [{ status: 200, description: 'Review findings', schema: findingListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Ingest review findings',
      description: 'Validates and anchors a batch of review findings against the current document text. Earlier open findings of the same source are superseded unless supersede is false.',
      requestBody: { contentType: 'application/json', schema: findingIngestSchema },
      responses: [{ status: 201, description: 'Findings ingested', schema: findingIngestResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden or document archived', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
        { status: 422, description: 'Open findings limit exceeded', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST }
