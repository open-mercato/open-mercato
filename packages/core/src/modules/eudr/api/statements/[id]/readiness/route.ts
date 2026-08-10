import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { EudrDueDiligenceStatement } from '../../../../data/entities'
import { EUDR_STATEMENT_STATUSES } from '../../../../data/validators'
import { evaluateSubmissionGate } from '../../../../lib/statement-lifecycle'
import {
  loadLatestAssessmentForGate,
  loadStatementSubmissionsForGate,
} from '../../../../commands/statements'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view'] },
}

const uuidSchema = z.string().uuid()

type AuthenticatedContext = Exclude<AuthContext, null>

function hasPrivilegedStatementAccess(auth: AuthenticatedContext): boolean {
  return auth.isSuperAdmin === true
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const { translate } = await resolveTranslations()
  if (!uuidSchema.safeParse(id).success) {
    return Response.json({ error: translate('eudr.errors.statement_not_found', 'Statement not found') }, { status: 404 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return Response.json({ error: translate('eudr.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const statementFilter: FilterQuery<EudrDueDiligenceStatement> = {
    id,
    deletedAt: null,
  }
  if (auth.tenantId) {
    statementFilter.tenantId = auth.tenantId
  } else if (!auth.isSuperAdmin) {
    return Response.json({ error: translate('eudr.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  if (!hasPrivilegedStatementAccess(auth)) {
    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (Array.isArray(orgScope?.filterIds)) {
      statementFilter.organizationId = { $in: orgScope.filterIds }
    } else {
      const organizationId = orgScope?.selectedId ?? auth.orgId
      if (!organizationId) {
        return Response.json({ error: translate('eudr.errors.forbidden', 'Forbidden') }, { status: 403 })
      }
      statementFilter.organizationId = organizationId
    }
  }

  const statement = await em.findOne(EudrDueDiligenceStatement, statementFilter)
  if (!statement) {
    return Response.json({ error: translate('eudr.errors.statement_not_found', 'Statement not found') }, { status: 404 })
  }

  const referencedStatements = Array.isArray(statement.referencedStatements)
    ? statement.referencedStatements
    : []
  const [submissions, latestAssessment] = await Promise.all([
    loadStatementSubmissionsForGate(em.fork(), statement),
    loadLatestAssessmentForGate(em.fork(), statement),
  ])
  const gate = evaluateSubmissionGate({
    actorRole: statement.actorRole ?? null,
    referencedStatementsCount: referencedStatements.length,
    submissions,
    latestAssessment,
  })

  return Response.json({
    status: statement.status,
    allowed: gate.allowed,
    reasons: gate.reasons.map((reason) => `eudr.gate.${reason}`),
  })
}

const errorSchema = z.object({
  error: z.string(),
})

const readinessResponseSchema = z.object({
  status: z.enum(EUDR_STATEMENT_STATUSES),
  allowed: z.boolean(),
  reasons: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Evaluate the submit gate for a due diligence statement',
  methods: {
    GET: {
      summary: 'Evaluate the submit gate for a due diligence statement',
      description: 'Runs the draft→submitted gate evaluation without transitioning the statement, returning the unmet requirements as machine-readable i18n keys (eudr.gate.*). Lets the UI show a live readiness checklist before the operator attempts Submit.',
      responses: [
        {
          status: 200,
          description: 'Gate evaluation result',
          schema: readinessResponseSchema,
        },
      ],
      errors: [
        {
          status: 404,
          description: 'Statement not found',
          schema: errorSchema,
        },
      ],
    },
  },
}
