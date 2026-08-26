/**
 * `POST /api/staff/timesheets/reports/[id]/unlock` — screen 15.
 *
 * Gated on `staff.timesheets.reports.unlock`, deliberately a DIFFERENT feature
 * from `staff.timesheets.lock`. Screen 15 note 4 asked who may unlock and
 * observed that §10 leaves nobody "above" a Team Leader; the answer is a
 * separate grant that can be withheld from a Team Leader who should not restate
 * billed time, rather than an admin role the requirements reject.
 *
 * The reason is mandatory at the schema level and is written verbatim into the
 * `unlocked` report event beside the actor and the timestamp, which is what
 * makes this the "explicit, audited action" US-G3 asks for rather than a confirm
 * dialog.
 */

import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import { forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffTimeReportUnlockSchema } from '../../../../../data/validators'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../../guards'
import { runTimesheetInterceptors } from '../../../_shared/withTimesheetInterceptors'
import {
  staffTimeReportCommandIds,
  type StaffTimeReportUnlockResult,
} from '../../../../../commands/timesheets-reports'
import { resolveReportRequestContext } from '../../shared'
import { evaluateReportUnlockPolicies } from '../../../../../lib/timesheets-reports/reportApprovalPolicies'

const logger = createLogger('staff').child({ component: 'api/timesheets/reports/unlock' })

const UNLOCK_FEATURE = 'staff.timesheets.reports.unlock'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [UNLOCK_FEATURE] },
}

const bodySchema = z.object({ reason: z.string().trim().min(1).max(2000) })

export async function POST(req: Request) {
  try {
    const context = await resolveReportRequestContext(req, { segment: 'unlock' })
    const { container, auth, organizationScope, tenantId, organizationId, reportId, translate, grantedFeatures } =
      context

    // Checked unconditionally. The `grantedFeatures &&` this replaces turned the
    // check off whenever the grant read failed — harmless here only because the
    // route metadata happens to require the same feature, which is exactly the
    // shape that leaked rates on the report routes where no such backstop existed.
    if (!(await resolveFeatureAccess(container, auth.sub ?? null, [UNLOCK_FEATURE], { tenantId, organizationId })).allowed) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'POST',
      scope: { container, userId: auth.sub, tenantId, organizationId, userFeatures: grantedFeatures },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const parsed = bodySchema.parse(session.body)

    // EP-41 runs strictly AFTER the ACL gate above and can only refuse. A
    // four-eyes or accounting-period policy narrows who may unlock; nothing here
    // widens it past staff.timesheets.reports.unlock.
    const refusal = evaluateReportUnlockPolicies({
      tenantId,
      organizationId,
      reportId,
      actorUserId: typeof auth.sub === 'string' ? auth.sub : null,
      actorFeatures: grantedFeatures,
      status: 'closed',
      reason: parsed.reason,
    })
    if (refusal) {
      throw forbidden(translate(refusal.messageKey, translate('staff.errors.forbidden', 'Forbidden')))
    }

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: auth.sub ?? '',
        tenantId,
        organizationId,
        userFeatures: grantedFeatures,
      },
      input: {
        resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeReport,
        resourceId: reportId,
        operation: 'update',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const effective = guardResult.modifiedPayload
      ? bodySchema.parse({ ...parsed, ...guardResult.modifiedPayload })
      : parsed

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      { id: string; reason: string },
      StaffTimeReportUnlockResult
    >(staffTimeReportCommandIds.unlock, {
      input: { id: reportId, reason: effective.reason },
      ctx,
    })

    await guardResult.runAfterSuccess()

    const response = await session.respond(200, {
      id: result?.reportId ?? reportId,
      status: 'draft',
      unlockedEntryCount: result?.unlockedEntryCount ?? 0,
    })
    if (logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          // Explicitly no undo token: unwinding a billing freeze is the unlock
          // endpoint, which demands a reason and its own feature.
          undoToken: '',
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? STAFF_TIME_TRACKING_RESOURCE_KINDS.timeReport,
          resourceId: logEntry.resourceId ?? reportId,
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
        {
          error: translate(
            'staff.time_tracking.reports.errors.reasonRequired',
            'An unlock reason is required.',
          ),
          details: err.issues,
        },
        { status: 400 },
      )
    }
    logger.error('staff.timesheets.reports.unlock failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

const unlockResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('draft'),
  unlockedEntryCount: z.number().int(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Unlock a closed customer report',
  methods: {
    POST: {
      summary: 'Unlock a closed customer report',
      description:
        'Clears locked_report_id / locked_at on every entry this report froze, removes its freeze records so a previously billed hour stops being counted as already reported, returns the report to draft and appends an `unlocked` event carrying the reason, the actor and the totals that were frozen. The reason is mandatory. Requires staff.timesheets.reports.unlock, which is deliberately separate from staff.timesheets.lock.',
      requestBody: { contentType: 'application/json', schema: staffTimeReportUnlockSchema.pick({ reason: true }) },
      responses: [{ status: 200, description: 'Report unlocked', schema: unlockResponseSchema }],
      errors: [
        { status: 400, description: 'Missing or empty reason' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.reports.unlock, or refused by a registered report approval policy' },
        { status: 404, description: 'Report not found or not accessible' },
        { status: 409, description: 'Report is not closed (report_not_closed)' },
      ],
    },
  },
}
