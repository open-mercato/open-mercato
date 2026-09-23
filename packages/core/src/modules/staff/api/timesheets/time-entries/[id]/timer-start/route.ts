import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  staffTimeEntryStartTimerExistingSchema,
  type StaffTimeEntryStartTimerExistingInput,
} from '../../../../../data/validators'
import {
  STAFF_TIME_TRACKING_RESOURCE_KINDS,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../../guards'
import { runTimesheetInterceptors } from '../../../_shared/withTimesheetInterceptors'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

type StartTimerExistingCommandResult = { timeEntryId: string }

function extractEntryIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-entries\/([^/]+)\/timer-start/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; translate: (key: string, fallback?: string) => string }> {
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
  return { ctx, translate }
}

export async function POST(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    const entryId = extractEntryIdFromUrl(req)
    if (!entryId) {
      throw new CrudHttpError(400, { error: translate('staff.timesheets.errors.missingEntryId', 'Missing entry ID.') })
    }

    // The entry id comes from the URL, never the body — merge it into the
    // command input so scope resolution and validation see a complete payload.
    const missingScopeMessage = { key: 'staff.errors.missingScope', fallback: 'Missing tenant or organization scope.' }
    const input = parseScopedCommandInput(
      staffTimeEntryStartTimerExistingSchema,
      { id: entryId },
      ctx,
      translate,
      { messages: { tenantRequired: missingScopeMessage, organizationRequired: missingScopeMessage } },
    )

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'POST',
      scope: {
        container: ctx.container,
        userId: ctx.auth?.sub,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const guardContext = {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: ctx.auth?.sub ?? '',
      resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeEntry,
      resourceId: input.id,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const guardResult = await runStaffMutationGuards(ctx.container, guardContext)
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<
      StaffTimeEntryStartTimerExistingInput,
      StartTimerExistingCommandResult
    >(
      'staff.timesheets.time_entries.start_timer_existing',
      { input, ctx },
    )

    if (guardResult.afterSuccessCallbacks.length) {
      await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, guardContext)
    }

    const response = await session.respond(200, { ok: true })
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
    // Routing this write through the command bus put a command interceptor
    // between the request and the handler, so its rejection carries the status
    // the interceptor chose and must not be flattened into the generic 400.
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.timesheets.time-entries.timer-start failed', { err })
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.timerStart', 'Failed to start timer.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Start timer for a time entry',
  methods: {
    POST: {
      summary: 'Start timer for a time entry',
      description: 'Starts the timer on a time entry by setting startedAt and creating an initial work segment.',
      responses: [
        { status: 200, description: 'Timer started', schema: z.object({ ok: z.literal(true) }) },
        { status: 404, description: 'Time entry not found', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description:
            'Timer already started, another timer is already running for this staff member, or the entry is locked in a closed report (code time_entry_locked)',
          schema: z.object({ error: z.string(), code: z.string().optional(), lockedReportId: z.string().uuid().nullable().optional() }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
