import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffTimeEntryStartTimerSchema, type StaffTimeEntryStartTimerInput } from '../../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../guards'
import { runTimesheetInterceptors } from '../../_shared/withTimesheetInterceptors'

const logger = createLogger('staff')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

async function buildContext(
  req: Request
): Promise<{
  ctx: CommandRuntimeContext
  translate: (key: string, fallback?: string) => string
  tenantId: string | null
  organizationId: string | null
}> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return {
    ctx,
    translate,
    tenantId: scope?.tenantId ?? auth.tenantId ?? null,
    organizationId: scope?.selectedId ?? auth.orgId ?? null,
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, translate, tenantId, organizationId } = await buildContext(req)
    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'POST',
      scope: { container: ctx.container, userId: ctx.auth?.sub, tenantId, organizationId },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const input = parseScopedCommandInput(staffTimeEntryStartTimerSchema, session.body, ctx, translate)
    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<StaffTimeEntryStartTimerInput, { timeEntryId: string }>(
      'staff.timesheets.time_entries.start_timer',
      { input, ctx },
    )
    const response = await session.respond(201, { ok: true, id: result?.timeEntryId ?? null })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? STAFF_TIME_TRACKING_RESOURCE_KINDS.timeEntry,
          resourceId: logEntry.resourceId ?? result?.timeEntryId ?? null,
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
    logger.error('staff.timesheets.time-entries.start-timer failed', { err })
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.timerStart', 'Failed to start timer.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Start a timesheet timer',
  methods: {
    POST: {
      summary: 'Start a timesheet timer',
      description:
        'Atomically creates a timer-sourced time entry and starts it (sets startedAt and creates the initial work segment) in a single transaction, so a partial failure cannot leave an orphaned, unstarted entry. An optional `taskId` is validated and stored by the same write, so starting a timer from a board card or the task drawer takes one request instead of a start followed by a link that can fail; when only `taskId` is sent, the project follows from the task.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeEntryStartTimerSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Timer started',
          schema: z.object({ ok: z.literal(true), id: z.string().uuid().nullable() }),
        },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'Another timer is already running for this staff member',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 422,
          description:
            'Referenced time project or task not found, out of scope, or the task belongs to another project',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
