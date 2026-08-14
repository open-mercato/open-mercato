/**
 * `POST /api/staff/timesheets/reports/[id]/close` — US-G3, screen 14's primary
 * action.
 *
 * Gated on `staff.timesheets.lock`, the feature that already existed for exactly
 * this ("Lock time periods"), rather than on a new one. Exporting a PDF does NOT
 * come through here: screen 14 note 5 makes closing the only thing that freezes,
 * so a download can never silently lock a team's timesheet.
 *
 * The whole freeze is one transaction inside the command. This file's job is
 * auth, scope, the mutation guard and turning the command's refusals into the
 * bodies the screen can act on.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  staffTimeReportCommandIds,
  STAFF_TIME_REPORT_RESOURCE_KIND,
  type StaffTimeReportCloseResult,
} from '../../../../../commands/timesheets-reports'
import { resolveReportRequestContext } from '../../shared'

const logger = createLogger('staff').child({ component: 'api/timesheets/reports/close' })

const LOCK_FEATURE = 'staff.timesheets.lock'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [LOCK_FEATURE] },
}

export async function POST(req: Request) {
  try {
    const context = await resolveReportRequestContext(req, { segment: 'close' })
    const { container, auth, organizationScope, tenantId, organizationId, reportId, translate, grantedFeatures } =
      context

    if (grantedFeatures && !authorizeFeatures([LOCK_FEATURE], { grantedFeatures })) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: auth.sub ?? '',
        tenantId,
        organizationId,
        userFeatures: grantedFeatures ?? undefined,
      },
      input: {
        resourceKind: STAFF_TIME_REPORT_RESOURCE_KIND,
        resourceId: reportId,
        operation: 'update',
        mutationPayload: { id: reportId },
      },
    })
    if (!guardResult.ok) return guardResult.response

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<{ id: string }, StaffTimeReportCloseResult>(
      staffTimeReportCommandIds.close,
      { input: { id: reportId }, ctx },
    )

    await guardResult.runAfterSuccess()

    const response = NextResponse.json(
      {
        id: result?.reportId ?? reportId,
        status: 'closed',
        lockedEntryCount: result?.lockedEntryCount ?? 0,
        totalAmount: result?.totalAmount ?? 0,
        totalBillableMinutes: result?.totalBillableMinutes ?? 0,
        totalNonbillableMinutes: result?.totalNonbillableMinutes ?? 0,
      },
      { status: 200 },
    )
    if (logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          // Explicitly no undo token: unwinding a billing freeze is the unlock
          // endpoint, which demands a reason and its own feature. A one-click
          // undo bar over a closed invoice is exactly what US-G3 forbids.
          undoToken: '',
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? STAFF_TIME_REPORT_RESOURCE_KIND,
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
        { error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('staff.timesheets.reports.close failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

const closeResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('closed'),
  lockedEntryCount: z.number().int(),
  totalAmount: z.number(),
  totalBillableMinutes: z.number().int(),
  totalNonbillableMinutes: z.number().int(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Close and lock a customer report',
  methods: {
    POST: {
      summary: 'Close and lock a customer report',
      description:
        'Freezes the report: writes one staff_time_report_entries snapshot per covered entry (raw minutes, rounded minutes, rate, currency, amount, billable), stamps locked_report_id / locked_at on entries that are not already locked by an earlier report, freezes the report totals and appends a `closed` event — all in one transaction. Exporting never locks; this endpoint is the only thing that does.',
      responses: [{ status: 200, description: 'Report closed', schema: closeResponseSchema }],
      errors: [
        { status: 400, description: 'Missing report id or scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.lock' },
        { status: 404, description: 'Report not found or not accessible' },
        { status: 409, description: 'Report is already closed (report_closed)' },
        { status: 422, description: 'Report covers no entries (report_empty)' },
      ],
    },
  },
}
