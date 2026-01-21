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
import {
  resourcesResourceTagAssignmentSchema,
  type ResourcesResourceTagAssignmentInput,
} from '../../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; translate: (key: string, fallback?: string) => string }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('resources.errors.unauthorized', 'Unauthorized') })
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
    const input = parseScopedCommandInput(resourcesResourceTagAssignmentSchema, body, ctx, translate)
    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<ResourcesResourceTagAssignmentInput, { assignmentId: string }>(
      'resources.resourceTags.assign',
      { input, ctx },
    )
    const response = NextResponse.json({ id: result?.assignmentId ?? null }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'resources.resourceTagAssignment',
          resourceId: logEntry.resourceId ?? result?.assignmentId ?? null,
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
    console.error('resources.resourceTags.assign failed', err)
    return NextResponse.json({ error: translate('resources.resources.tags.updateError', 'Failed to update tags.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Resources',
  summary: 'Assign resource tag',
  methods: {
    POST: {
      summary: 'Assign resource tag',
      description: 'Assigns a tag to a resources resource.',
      requestBody: {
        contentType: 'application/json',
        schema: resourcesResourceTagAssignmentSchema,
      },
      responses: [
        { status: 201, description: 'Tag assignment created', schema: z.object({ id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
