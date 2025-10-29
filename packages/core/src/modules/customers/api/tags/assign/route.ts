import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { tagAssignmentSchema } from '../../../data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; auth: Awaited<ReturnType<typeof getAuthFromRequest>>; translate: (key: string, fallback?: string) => string }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { ctx, auth, translate }
}

export async function POST(req: Request) {
  try {
    const { ctx, auth, translate } = await buildContext(req)
    const body = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(body, ctx, translate)
    const input = tagAssignmentSchema.parse(scoped)

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.tags.assign', { input, ctx })
    const response = NextResponse.json({ id: result?.assignmentId ?? result?.id ?? null }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.tagAssignment',
          resourceId: logEntry.resourceId ?? (result?.assignmentId ?? null),
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.tags.assign failed', err)
    return NextResponse.json({ error: translate('customers.errors.assign_failed', 'Failed to assign tag') }, { status: 400 })
  }
}

const tagAssignmentResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const tagAssignmentErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Assign customer tag',
  methods: {
    POST: {
      summary: 'Assign tag to customer entity',
      description: 'Links a tag to a customer entity within the validated tenant / organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: tagAssignmentSchema,
      },
      responses: [
        { status: 201, description: 'Tag assigned to customer', schema: tagAssignmentResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation or assignment failed', schema: tagAssignmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tagAssignmentErrorSchema },
        { status: 403, description: 'Insufficient tenant/organization access', schema: tagAssignmentErrorSchema },
      ],
    },
  },
}
