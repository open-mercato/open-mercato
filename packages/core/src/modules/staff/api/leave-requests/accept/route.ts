import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffLeaveRequestDecisionSchema, type StaffLeaveRequestDecisionInput } from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.leave_requests.manage'] },
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
    const body = await req.json().catch(() => ({}))
    const input = parseScopedCommandInput(staffLeaveRequestDecisionSchema, body, ctx, translate)
    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<StaffLeaveRequestDecisionInput, { requestId: string }>(
      'staff.leave-requests.accept',
      { input, ctx },
    )
    const response = NextResponse.json({ ok: true, id: result?.requestId ?? null }, { status: 200 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'staff.leave_request',
          resourceId: logEntry.resourceId ?? result?.requestId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('staff.leave-requests.accept failed', err)
    return NextResponse.json({ error: translate('staff.leaveRequests.errors.accept', 'Failed to approve leave request.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Approve leave request',
  methods: {
    POST: {
      summary: 'Approve leave request',
      description: 'Approves a leave request and adds unavailability rules for the staff member.',
      requestBody: {
        contentType: 'application/json',
        schema: staffLeaveRequestDecisionSchema,
      },
      responses: [
        { status: 200, description: 'Leave request approved', schema: z.object({ ok: z.literal(true), id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
