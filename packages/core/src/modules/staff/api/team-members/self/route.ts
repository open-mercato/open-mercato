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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTeamMember } from '../../../data/entities'
import {
  staffTeamMemberSelfCreateSchema,
  type StaffTeamMemberSelfCreateInput,
  type StaffTeamMemberCreateInput,
} from '../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.leave_requests.send'] },
  POST: { requireAuth: true, requireFeatures: ['staff.leave_requests.send'] },
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

const selfMemberResponseSchema = z.object({
  member: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      userId: z.string().uuid().nullable(),
      teamId: z.string().uuid().nullable(),
      availabilityRuleSetId: z.string().uuid().nullable(),
    })
    .nullable(),
})

export async function GET(req: Request) {
  try {
    const { ctx } = await buildContext(req)
    const auth = ctx.auth
    if (!auth?.sub) return NextResponse.json({ member: null })
    const em = (ctx.container.resolve('em') as any)
    const member = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, deletedAt: null },
      undefined,
      { tenantId: auth.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
    )
    if (!member) return NextResponse.json({ member: null })
    return NextResponse.json({
      member: {
        id: member.id,
        displayName: member.displayName,
        userId: member.userId ?? null,
        teamId: member.teamId ?? null,
        availabilityRuleSetId: member.availabilityRuleSetId ?? null,
      },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    console.error('staff.teamMembers.self.load failed', err)
    return NextResponse.json({ member: null })
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    const auth = ctx.auth
    if (!auth?.sub) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    const body = await req.json().catch(() => ({}))
    const parsed = parseScopedCommandInput(staffTeamMemberSelfCreateSchema, body, ctx, translate)
    const em = (ctx.container.resolve('em') as any)
    const existing = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, deletedAt: null },
      undefined,
      { tenantId: auth.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
    )
    if (existing) {
      throw new CrudHttpError(409, { error: translate('staff.teamMembers.self.exists', 'Team member profile already exists.') })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const selfInput: StaffTeamMemberCreateInput = {
      ...parsed,
      userId: auth.sub,
      teamId: null,
      roleIds: [],
      tags: [],
      availabilityRuleSetId: null,
      isActive: true,
    }
    const { result, logEntry } = await commandBus.execute<StaffTeamMemberCreateInput, { memberId: string }>(
      'staff.team-members.create',
      {
        input: selfInput,
        ctx,
      },
    )
    const response = NextResponse.json({ id: result?.memberId ?? null }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'staff.team_member',
          resourceId: logEntry.resourceId ?? result?.memberId ?? null,
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
    console.error('staff.teamMembers.self.create failed', err)
    return NextResponse.json({ error: translate('staff.teamMembers.form.errors.create', 'Failed to create team member.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Self team member profile',
  methods: {
    GET: {
      summary: 'Get current user team member profile',
      description: 'Returns the staff team member linked to the current user, if any.',
      responses: [
        { status: 200, description: 'Team member profile', schema: selfMemberResponseSchema },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
    POST: {
      summary: 'Create current user team member profile',
      description: 'Creates a team member profile for the signed-in user.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTeamMemberSelfCreateSchema,
      },
      responses: [
        { status: 201, description: 'Team member created', schema: z.object({ id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Already exists', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
