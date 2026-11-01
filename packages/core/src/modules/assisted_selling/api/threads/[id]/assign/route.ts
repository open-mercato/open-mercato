import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assistedSellingThreadAssignRequestSchema } from '../../../../data/validators'
import { organizationIdsFromAssistedSellingScope } from '../../../../lib/organizationScope'
import { assignThreadCommand, type AssistedSellingThreadAssignInput, type AssistedSellingThreadAssignResult } from '../../../../commands/threads'

const logger = createLogger('assisted_selling').child({ component: 'api' })

// Step 5.3 (§6.1). `POST /threads/:id/assign` — "Sets `assigned_actor_id`. Optimistic-locked
// on the thread's `updated_at`: two reps claiming the same conversation get one success and
// one 409, never a silent last-write-wins." `actorId` omitted assigns the caller ("assign to
// me"); the standard optimistic-lock header is accepted alongside the body's own `updatedAt`.

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['assisted_selling.threads.participate'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteParams = { params?: { id?: string } | Promise<{ id?: string }> }

export async function POST(req: Request, routeCtx: RouteParams) {
  const { translate } = await resolveTranslations()
  try {
    const params = paramsSchema.safeParse(await routeCtx.params)
    if (!params.success) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalid_thread_id', 'Invalid thread id') }, { status: 400 })
    }

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('assisted_selling.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromAssistedSellingScope(scope, scope?.selectedId ?? auth.orgId ?? null)

    const rawBody = await readJsonSafe<Record<string, unknown>>(req, {})
    const body = assistedSellingThreadAssignRequestSchema.parse(rawBody)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationIds && organizationIds.length === 1 ? organizationIds[0] : (auth.orgId ?? null),
      organizationIds,
      request: req,
    }

    const commandInput: AssistedSellingThreadAssignInput = {
      tenantId: auth.tenantId,
      organizationIds,
      threadId: params.data.id,
      actorId: body.actorId,
      updatedAt: body.updatedAt ?? readOptimisticLockExpected(req) ?? undefined,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingThreadAssignInput, AssistedSellingThreadAssignResult>(
      assignThreadCommand.id,
      { input: commandInput, ctx },
    )

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('assisted_selling.thread.assign failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.unexpected', 'Unexpected error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Assign a selling conversation',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Set assigned_actor_id, optimistic-locked on updated_at (§6.1)',
      requestBody: { contentType: 'application/json', schema: assistedSellingThreadAssignRequestSchema },
      responses: [{ status: 200, description: 'The updated assignment' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing required feature(s)' },
        { status: 404, description: 'Thread not found or outside the caller\'s organizations' },
        { status: 409, description: 'Optimistic-lock conflict' },
      ],
    },
  },
}
