import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ProgressService } from '../../../../progress/lib/progressService'
import { aiCategorizationBulkSchema } from '../../../data/validators'
import type { CatalogCategorizationService } from '../../../lib/aiCategorization/categorizationService'
import {
  CATALOG_PRODUCT_AI_CATEGORIZE_JOB_TYPE,
  CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE,
  type CatalogProductAiCategorizeJobPayload,
} from '../../../lib/aiCategorization/bulkCategorize'
import { runBulkCreateMutationGuards } from '../../../lib/bulkCreateMutationGuards'
import { getCatalogQueue } from '../../../lib/catalogQueue'

const logger = createLogger('catalog')

const MAX_REPORTED_ISSUES = 20

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['catalog.ai_categorization.use'] },
}

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

const unavailableSchema = z.object({
  code: z.literal('ai_categorization_unavailable'),
  reason: z.string().nullable(),
})

function failure(message: string, status: number, errors?: Array<{ path: string; message: string }>) {
  return NextResponse.json(
    responseSchema.parse({ ok: false, progressJobId: null, message, errors }),
    { status },
  )
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return failure('Unauthorized', 401)

  const parsed = aiCategorizationBulkSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return failure(
      'Invalid payload',
      400,
      parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    )
  }
  const productIds = Array.from(new Set(parsed.data.productIds))

  try {
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (scope.selectionRejected) {
      return failure(
        'Your selected organization is no longer available. Please re-select an organization and try again.',
        422,
      )
    }
    const organizationId = scope.selectedId
    if (!organizationId) return failure('Organization context is required', 400)

    const categorizationService = container.resolve('catalogCategorizationService') as CatalogCategorizationService
    const status = await categorizationService.getStatus({ tenantId: auth.tenantId })
    if (!status.effective) {
      return NextResponse.json(
        unavailableSchema.parse({ code: 'ai_categorization_unavailable', reason: status.reason ?? null }),
        { status: 409 },
      )
    }

    const guardDecision = await runBulkCreateMutationGuards({
      container,
      auth,
      request: req,
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'catalog.ai_categorization_bulk',
      itemCount: productIds.length,
    })
    if (!guardDecision.ok) {
      return NextResponse.json(guardDecision.body, { status: guardDecision.status })
    }

    const progressService = container.resolve('progressService') as ProgressService
    const progressJob = await progressService.createJob(
      {
        jobType: CATALOG_PRODUCT_AI_CATEGORIZE_JOB_TYPE,
        name: 'AI categorize products',
        description: `${productIds.length} catalog products queued for AI categorization`,
        totalCount: productIds.length,
        cancellable: true,
        meta: {
          source: 'catalog.ai-categorization.bulk',
          scope: parsed.data.scope,
        },
      },
      {
        tenantId: auth.tenantId,
        organizationId,
        userId: auth.sub,
      },
    )

    const payload: CatalogProductAiCategorizeJobPayload = {
      progressJobId: progressJob.id,
      ids: productIds,
      scope: {
        organizationId,
        tenantId: auth.tenantId,
        userId: auth.sub,
      },
    }
    await getCatalogQueue(CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE).enqueue(payload)

    return NextResponse.json(
      responseSchema.parse({
        ok: true,
        progressJobId: progressJob.id,
        message: 'AI categorization started.',
      }),
      { status: 202 },
    )
  } catch (err) {
    logger.error('catalog.ai_categorization.bulk.POST Unexpected error', { err })
    return failure('Internal server error', 500)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Start bulk AI categorization of catalog products',
  methods: {
    POST: {
      summary: 'Queue AI category suggestions for up to 1000 products',
      description:
        'Creates a cancellable progress job and enqueues one worker run. Suggestions are stored as pending and reviewed separately.',
      tags: ['Catalog'],
      requestBody: { schema: aiCategorizationBulkSchema },
      responses: [{ status: 202, description: 'Bulk run queued', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or missing organization context', schema: responseSchema },
        { status: 401, description: 'Unauthorized', schema: responseSchema },
        { status: 409, description: 'AI categorization is disabled or unavailable', schema: unavailableSchema },
        { status: 422, description: 'Blocked by a mutation guard or rejected organization selection' },
      ],
    },
  },
}
