import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStaffEvent } from '../../../../../events'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffTimeProjectChangeCurrencySchema } from '../../../../../data/validators'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../../guards'
import { runTimesheetInterceptors } from '../../../_shared/withTimesheetInterceptors'
import {
  staffTimeProjectChangeCurrencyCommandId,
  type StaffTimeProjectChangeCurrencyCommandInput,
  type StaffTimeProjectChangeCurrencyResult,
} from '../../../../../commands/timesheets-projects'

const logger = createLogger('staff').child({ component: 'api/timesheets/time-projects/change-currency' })

const MANAGE_FEATURE = 'staff.timesheets.projects.manage'
const RESOURCE_KIND = STAFF_TIME_TRACKING_RESOURCE_KINDS.timeProject

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

function extractProjectIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-projects\/([^/]+)\/change-currency/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * D-3: relabels a project's currency without converting a single historical
 * amount. The `acknowledged: true` literal in the body is deliberate friction —
 * the client must have shown the non-conversion warning — and the request is
 * refused with `409 project_has_locked_entries` while any of the project's
 * entries is frozen inside a closed report.
 */
export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const timeProjectId = extractProjectIdFromUrl(req)
    if (!timeProjectId) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.projectRequired', 'Time project id is required.'),
      })
    }

    const actorId = auth.sub ?? ''
    // One lookup through the module's single RBAC authority, answering both
    // questions this route asks: may the caller manage projects, and what grant
    // list do the interceptors and the mutation-guard registry gate on. The
    // decision is checked unconditionally and fails closed; the list is plumbing
    // and is empty — never absent — when RBAC could not produce it.
    const access = await resolveFeatureAccess(container, actorId, [MANAGE_FEATURE], { tenantId, organizationId })
    if (!access.allowed) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }
    const grantedFeatures = access.grantedFeatures

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'POST',
      scope: { container, userId: actorId, tenantId, organizationId, userFeatures: grantedFeatures },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const parsed = staffTimeProjectChangeCurrencySchema.parse(session.body)

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: actorId,
        tenantId,
        organizationId,
        userFeatures: grantedFeatures,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: timeProjectId,
        operation: 'update',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const effective = guardResult.modifiedPayload
      ? staffTimeProjectChangeCurrencySchema.parse({ ...parsed, ...guardResult.modifiedPayload })
      : parsed

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      StaffTimeProjectChangeCurrencyCommandInput,
      StaffTimeProjectChangeCurrencyResult
    >(staffTimeProjectChangeCurrencyCommandId, {
      input: { ...effective, id: timeProjectId },
      ctx,
    })

    await guardResult.runAfterSuccess()

    void emitStaffEvent('staff.timesheets.time_project.currency_changed', {
      id: result?.timeProjectId ?? timeProjectId,
      tenantId,
      organizationId,
      currencyCode: result?.currencyCode ?? effective.currencyCode,
      previousCurrencyCode: result?.previousCurrencyCode ?? null,
      converted: false,
    }, { persistent: true }).catch((err) => {
      logger.error('staff.timesheets emit time_project.currency_changed failed', { err })
    })

    const response = await session.respond(200, {
      id: result?.timeProjectId ?? timeProjectId,
      currencyCode: result?.currencyCode ?? effective.currencyCode,
      previousCurrencyCode: result?.previousCurrencyCode ?? null,
      converted: false,
    })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? RESOURCE_KIND,
          resourceId: logEntry.resourceId ?? timeProjectId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('staff.timesheets.time-projects.change-currency failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

const blockingReportSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().nullable(),
  title: z.string().nullable(),
})

const changeCurrencyResponseSchema = z.object({
  id: z.string().uuid(),
  currencyCode: z.string(),
  previousCurrencyCode: z.string().nullable(),
  converted: z.literal(false),
})

const lockedConflictSchema = z.object({
  code: z.literal('project_has_locked_entries'),
  error: z.string(),
  lockedEntryCount: z.number().int(),
  lockedReports: z.array(blockingReportSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Change a time project currency',
  methods: {
    POST: {
      summary: 'Change a time project currency',
      description:
        'Relabels the project currency without converting any historical amount. Requires an explicit `acknowledged: true` and is refused while any of the project entries is locked into a closed report.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeProjectChangeCurrencySchema,
      },
      responses: [
        { status: 200, description: 'Currency relabelled', schema: changeCurrencyResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body, or the change was not acknowledged' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.projects.manage' },
        { status: 404, description: 'Time project not found' },
        {
          status: 409,
          description: 'Project has entries locked into a closed report',
          schema: lockedConflictSchema,
        },
      ],
    },
  },
}
