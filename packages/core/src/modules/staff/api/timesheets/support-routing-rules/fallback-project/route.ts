import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveFeatureAccess } from '../../../../lib/time-tracking/featureAccess'
import {
  SUPPORT_ROUTING_RULE_RESOURCE_KIND,
  staffSupportRoutingRuleCommandIds,
  type SupportFallbackProjectResult,
} from '../../../../commands/support-routing-rules'
import type { StaffSupportFallbackProjectCreateInput } from '../../../../data/validators'

const logger = createLogger('staff').child({ component: 'api/timesheets/support-routing-rules/fallback-project' })

const SETTINGS_FEATURE = 'staff.timesheets.settings.manage'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [SETTINGS_FEATURE] },
}

export async function POST(req: Request): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }

    const actorId = auth.sub ?? ''
    const access = await resolveFeatureAccess(container, actorId, [SETTINGS_FEATURE], { tenantId, organizationId })
    if (!access.allowed) throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))

    const input: StaffSupportFallbackProjectCreateInput = { tenantId, organizationId }
    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: actorId, tenantId, organizationId, userFeatures: access.grantedFeatures },
      input: {
        resourceKind: SUPPORT_ROUTING_RULE_RESOURCE_KIND,
        resourceId: null,
        operation: 'create',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const routeCtx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<StaffSupportFallbackProjectCreateInput, SupportFallbackProjectResult>(
      staffSupportRoutingRuleCommandIds.createFallbackProject,
      { input, ctx: routeCtx },
    )
    await guardResult.runAfterSuccess()
    const response = NextResponse.json(
      { ruleId: result?.ruleId ?? null, timeProjectId: result?.timeProjectId ?? null, created: result?.created === true },
      { status: result?.created ? 201 : 200 },
    )
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? SUPPORT_ROUTING_RULE_RESOURCE_KIND,
          resourceId: logEntry.resourceId ?? result?.ruleId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    logger.error('staff.support.fallback-project POST failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_fallback_project_failed' })
    return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const responseSchema = z.object({
  ruleId: z.string().uuid().nullable(),
  timeProjectId: z.string().uuid().nullable(),
  created: z.boolean(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Create the support fallback project',
  methods: {
    POST: {
      summary: 'Create the support fallback project and rule',
      description:
        'Creates the "Customer support" project (no customer, standard task statuses) and the organization fallback routing rule pointing at it. Idempotent: when a fallback rule already exists nothing is created and the existing rule is returned with `created: false`.',
      responses: [
        { status: 201, description: 'Fallback project and rule created', schema: responseSchema },
        { status: 200, description: 'A fallback rule already existed', schema: responseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.settings.manage' },
      ],
    },
  },
}
