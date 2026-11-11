import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DocumentFinding } from '../data/entities'
import {
  documentFindingAnchorSchema,
  documentFindingAnchorStatusSchema,
  documentFindingSeveritySchema,
  documentFindingSourceSchema,
  documentFindingStatusSchema,
} from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { hasTier, resolvePermission } from '../lib/permissions'
import type {
  FindingApplyCommandInput,
  FindingDecisionCommandResult,
  FindingKeepCommandInput,
  FindingReopenCommandInput,
} from '../commands/findings'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from './_commands'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
  type DocumentsRouteContext,
} from './_shared'

export type FindingRouteParams = {
  params: Promise<{ id: string; findingId?: string }> | { id: string; findingId?: string }
}

export const findingResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  reviewId: z.string().uuid(),
  source: documentFindingSourceSchema,
  sourceWorkflowInstanceId: z.string().nullable(),
  sourceAgentRunId: z.string().nullable(),
  playbookId: z.string().uuid().nullable(),
  playbookVersion: z.number().int().nullable(),
  ruleId: z.string().uuid().nullable(),
  ruleCode: z.string().nullable(),
  severity: documentFindingSeveritySchema,
  title: z.string(),
  explanation: z.string(),
  sectionLabel: z.string().nullable(),
  quote: z.string(),
  occurrence: z.number().int(),
  suggestedText: z.string().nullable(),
  anchor: documentFindingAnchorSchema.nullable(),
  anchorStatus: documentFindingAnchorStatusSchema,
  status: documentFindingStatusSchema,
  appliedText: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedByUserId: z.string().uuid().nullable(),
  decidedAt: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const reviewPlaybookInfoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  version: z.number().int().nullable(),
})

export const findingPathParamsSchema = z.object({ id: z.string().uuid() })
export const findingDecisionPathParamsSchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().uuid(),
})

const NOT_FOUND_ERROR = 'Document not found'

export async function resolveFindingRouteParams(
  context: FindingRouteParams,
): Promise<{ documentId: string; findingId: string | null }> {
  const params = await context.params
  return { documentId: params.id, findingId: params.findingId ?? null }
}

/**
 * Findings are internal review analysis. Anyone below the editor tier, and
 * any caller outside the document's organization, receives the same 404 so
 * the existence of a review is not disclosed.
 */
export async function assertFindingsAccess(ctx: DocumentsRouteContext, documentId: string): Promise<void> {
  if (!z.string().uuid().safeParse(documentId).success) {
    throw new CrudHttpError(404, { error: NOT_FOUND_ERROR })
  }
  const tier = await resolvePermission(ctx.em, documentId, ctx.auth)
  if (!hasTier(tier, 'editor')) throw new CrudHttpError(404, { error: NOT_FOUND_ERROR })
}

export async function loadScopedFinding(
  ctx: DocumentsRouteContext,
  documentId: string,
  findingId: string,
): Promise<DocumentFinding> {
  const finding = z.string().uuid().safeParse(findingId).success
    ? await findOneWithDecryption(
      ctx.em,
      DocumentFinding,
      {
        id: findingId,
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    : null
  if (!finding) throw new CrudHttpError(404, { error: 'documents.findings.notFound' })
  return finding
}

type DecisionKind = 'apply' | 'keep' | 'reopen'

type DecisionCommandInput = FindingApplyCommandInput | FindingKeepCommandInput | FindingReopenCommandInput

type DecisionBody = { expectedUpdatedAt: string } & Record<string, unknown>

export async function handleFindingDecision<TBody extends DecisionBody>(
  kind: DecisionKind,
  request: Request,
  context: FindingRouteParams,
  bodySchema: z.ZodType<TBody>,
  buildDetails: (body: TBody) => Partial<DecisionCommandInput>,
): Promise<Response> {
  try {
    const { documentId, findingId } = await resolveFindingRouteParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertFindingsAccess(ctx, documentId)
    await assertDocumentNotArchived(ctx, documentId)
    const body = bodySchema.parse(await readBody(request))
    const finding = await loadScopedFinding(ctx, documentId, findingId ?? '')
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
      resourceId: finding.id,
      current: finding.updatedAt,
      expected: body.expectedUpdatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
      resourceId: finding.id,
      operation: 'update',
      mutationPayload: body,
      mutationPayloadSchema: bodySchema,
    })
    const commandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      findingId: finding.id,
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: body.expectedUpdatedAt,
      ...buildDetails(body),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<typeof commandInput, FindingDecisionCommandResult>(
      `documents.finding.${kind}`,
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
      resourceId: finding.id,
      operation: 'update',
    })
    return attachDocumentsOperationMetadata(
      NextResponse.json(execution.result.finding),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding, resourceId: finding.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, `documents.findings.${kind}`)
  }
}

export function buildFindingDecisionOpenApi(
  summary: string,
  requestSchema: z.ZodTypeAny,
  extraErrors: Array<{ status: number; description: string }> = [],
): OpenApiRouteDoc {
  return withDocumentsContextErrors({
    tag: 'Documents',
    summary,
    pathParams: findingDecisionPathParamsSchema,
    methods: {
      POST: {
        summary,
        requestBody: { contentType: 'application/json', schema: requestSchema },
        responses: [{ status: 200, description: 'Updated finding', schema: findingResponseSchema }],
        errors: [
          { status: 400, description: 'Validation failed', schema: routeErrorSchema },
          { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
          { status: 403, description: 'Forbidden or document archived', schema: routeErrorSchema },
          { status: 404, description: 'Document or finding not found', schema: routeErrorSchema },
          { status: 409, description: 'Optimistic lock conflict or invalid finding status', schema: routeErrorSchema },
          ...extraErrors.map((error) => ({ ...error, schema: routeErrorSchema })),
        ],
      },
    },
  })
}
