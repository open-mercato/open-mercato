import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { EUDR_SUBMISSION_STATUSES } from '../../../data/validators'

const logger = createLogger('eudr')

const querySchema = z.object({
  supplierEntityId: z.string().uuid(),
})

const responseSchema = z.object({
  submissions: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.record(z.string(), z.number().int().nonnegative()),
    avgCompleteness: z.number().int().min(0).max(100).nullable(),
  }),
  lastSubmissionAt: z.string().datetime().nullable(),
  plots: z.object({
    total: z.number().int().nonnegative(),
    withWarnings: z.number().int().nonnegative(),
  }).optional(),
})

const errorSchema = z.object({ error: z.string() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.submissions.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'EUDR supplier compliance aggregate',
  methods: {
    GET: {
      summary: 'Get supplier compliance readiness',
      description: 'Returns organization-scoped EUDR submission and permitted plot aggregates for a supplier.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Supplier compliance readiness', schema: responseSchema },
        { status: 400, description: 'Invalid query or organization context', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 500, description: 'Failed to load supplier compliance readiness', schema: errorSchema },
      ],
    },
  },
}

type SupplierComplianceDatabase = {
  eudr_evidence_submissions: {
    supplier_entity_id: string
    tenant_id: string
    organization_id: string
    status: string
    completeness_score: number
    created_at: Date
    deleted_at: Date | null
  }
  eudr_plots: {
    supplier_entity_id: string
    tenant_id: string
    organization_id: string
    validation_warnings: unknown
    is_active: boolean
    deleted_at: Date | null
  }
}

type RequestContext = {
  em: EntityManager
  tenantId: string
  organizationId: string
  hasFeature: (feature: string) => Promise<boolean>
}

type CountValue = string | number | bigint | null | undefined

function normalizeCount(value: CountValue): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0
}

function normalizeNullableInteger(value: CountValue): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function normalizeDateTime(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth?.tenantId) {
    throw new CrudHttpError(401, {
      error: translate('eudr.errors.unauthorized', 'Unauthorized'),
    })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('eudr.errors.organization_required', 'Organization context is required'),
    })
  }

  let rbacService: RbacService | null
  try {
    rbacService = container.resolve('rbacService') as RbacService
  } catch {
    rbacService = null
  }

  const tenantId = auth.tenantId
  const userId = auth.sub ?? null

  return {
    em: container.resolve('em') as EntityManager,
    tenantId,
    organizationId,
    hasFeature: async (feature: string) => {
      if (!rbacService || !userId) return false
      try {
        return await rbacService.userHasAllFeatures(userId, [feature], { tenantId, organizationId })
      } catch {
        return false
      }
    },
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsedQuery.success) {
      throw new CrudHttpError(400, {
        error: translate('eudr.errors.invalid_query', 'Invalid query'),
      })
    }

    const { supplierEntityId } = parsedQuery.data
    const db = ctx.em.getKysely<SupplierComplianceDatabase>()
    const submissionScope = db
      .selectFrom('eudr_evidence_submissions')
      .where('supplier_entity_id', '=', supplierEntityId)
      .where('tenant_id', '=', ctx.tenantId)
      .where('organization_id', '=', ctx.organizationId)
      .where('deleted_at', 'is', null)

    const [submissionTotals, submissionStatusRows, canViewPlots] = await Promise.all([
      submissionScope
        .select([
          sql<CountValue>`count(*)`.as('total'),
          sql<CountValue>`round(avg(completeness_score))`.as('avg_completeness'),
          sql<Date | string | null>`max(created_at)`.as('last_submission_at'),
        ])
        .executeTakeFirst(),
      submissionScope
        .select([
          'status',
          sql<CountValue>`count(*)`.as('total'),
        ])
        .groupBy('status')
        .execute(),
      ctx.hasFeature('eudr.plots.view'),
    ])

    const byStatus: Record<string, number> = Object.fromEntries(
      EUDR_SUBMISSION_STATUSES.map((status) => [status, 0]),
    )
    for (const row of submissionStatusRows) {
      if (!EUDR_SUBMISSION_STATUSES.includes(row.status as (typeof EUDR_SUBMISSION_STATUSES)[number])) continue
      byStatus[row.status] = normalizeCount(row.total)
    }

    let plots: { total: number; withWarnings: number } | undefined
    if (canViewPlots) {
      const plotCounts = await db
        .selectFrom('eudr_plots')
        .select([
          sql<CountValue>`count(*)`.as('total'),
          sql<CountValue>`count(*) filter (where jsonb_array_length(validation_warnings) > 0)`.as('with_warnings'),
        ])
        .where('supplier_entity_id', '=', supplierEntityId)
        .where('tenant_id', '=', ctx.tenantId)
        .where('organization_id', '=', ctx.organizationId)
        .where('deleted_at', 'is', null)
        .where('is_active', '=', true)
        .executeTakeFirst()

      plots = {
        total: normalizeCount(plotCounts?.total),
        withWarnings: normalizeCount(plotCounts?.with_warnings),
      }
    }

    const response = responseSchema.parse({
      submissions: {
        total: normalizeCount(submissionTotals?.total),
        byStatus,
        avgCompleteness: normalizeNullableInteger(submissionTotals?.avg_completeness),
      },
      lastSubmissionAt: normalizeDateTime(submissionTotals?.last_submission_at),
      ...(plots ? { plots } : {}),
    })

    return Response.json(response)
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }

    logger.error('Supplier compliance aggregate failed', {
      component: 'api/suppliers/compliance',
      err: error,
    })
    const { translate } = await resolveTranslations()
    return Response.json(
      { error: translate('eudr.errors.compliance_overview_failed', 'Failed to load EUDR compliance overview') },
      { status: 500 },
    )
  }
}
