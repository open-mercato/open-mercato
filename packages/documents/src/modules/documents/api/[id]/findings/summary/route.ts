import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadDocumentFindingSummary } from '../../../../lib/findingSummary'
import {
  assertFindingsAccess,
  findingPathParamsSchema,
  reviewPlaybookInfoSchema,
  resolveFindingRouteParams,
  type FindingRouteParams,
} from '../../../_findings'
import {
  handleDocumentsRouteError,
  resolveDocumentsContext,
  routeErrorSchema,
  withDocumentsContextErrors,
} from '../../../_shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

const severityCountsSchema = z.object({
  blocking: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
})

const findingSummaryResponseSchema = z.object({
  reviewId: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  source: z.string().nullable().describe('Source of the latest review (ai or import)'),
  playbook: reviewPlaybookInfoSchema.nullable(),
  coverage: z.object({
    rules: z.number().int().nonnegative().nullable(),
    references: z.number().int().nonnegative().nullable(),
  }).describe('Active rules and guidance documents of the review playbook; null when unknown or the playbook changed since the review'),
  open: severityCountsSchema,
  decided: z.object({
    applied: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
  }),
  unlocated: z.number().int().nonnegative(),
})

export async function GET(request: Request, context: FindingRouteParams): Promise<Response> {
  try {
    const { documentId } = await resolveFindingRouteParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertFindingsAccess(ctx, documentId)
    const summary = await loadDocumentFindingSummary(
      ctx.em,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      documentId,
    )
    return NextResponse.json(summary)
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.findings.summary')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document review findings summary',
  pathParams: findingPathParamsSchema,
  methods: {
    GET: {
      summary: 'Summarize the latest review',
      description: 'Open findings by severity, decided counts and unlocated count for the latest review, plus its source and playbook coverage (active rules and guidance documents, null when unknown). A process can treat open.blocking = 0 as the review being cleared.',
      responses: [{ status: 200, description: 'Review summary', schema: findingSummaryResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET }
