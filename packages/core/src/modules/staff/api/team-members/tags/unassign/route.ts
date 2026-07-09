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
import {
  staffTeamMemberTagAssignmentSchema,
  type StaffTeamMemberTagAssignmentInput,
} from '../../../../data/validators'
import {
  resolveUserFeatures,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../guards'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
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
    const input = parseScopedCommandInput(staffTeamMemberTagAssignmentSchema, body, ctx, translate)

    const auth = ctx.auth
    const tenantId = auth?.tenantId ?? ''
    const organizationId = ctx.selectedOrganizationId ?? null
    const guardResult = await runStaffMutationGuards(
      ctx.container,
      {
        tenantId,
        organizationId,
        userId: auth?.sub ?? '',
        resourceKind: 'staff.team_member',
        resourceId: input.memberId,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        mutationPayload: input,
      },
      resolveUserFeatures(auth),
    )
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<StaffTeamMemberTagAssignmentInput, { memberId: string }>(
      'staff.team-members.tags.unassign',
      { input, ctx },
    )

    if (guardResult.afterSuccessCallbacks.length) {
      await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
        tenantId,
        organizationId,
        userId: auth?.sub ?? '',
        resourceKind: 'staff.team_member',
        resourceId: result?.memberId ?? input.memberId,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    const response = NextResponse.json({ id: result?.memberId ?? null })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'staff.teamMemberTagAssignment',
          resourceId: logEntry.resourceId ?? result?.memberId ?? null,
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
    logger.error('staff.teamMembers.tags.unassign failed', { err })
    return NextResponse.json({ error: translate('staff.teamMembers.tags.updateError', 'Failed to update tags.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Unassign team member tag',
  methods: {
    POST: {
      summary: 'Unassign team member tag',
      description: 'Removes a tag from a staff team member.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTeamMemberTagAssignmentSchema,
      },
      responses: [
        { status: 200, description: 'Tag assignment removed', schema: z.object({ id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
