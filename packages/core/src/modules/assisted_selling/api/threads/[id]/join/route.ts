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
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assistedSellingThreadJoinRequestSchema } from '../../../../data/validators'
import { organizationIdsFromAssistedSellingScope } from '../../../../lib/organizationScope'
import { joinThreadCommand, type AssistedSellingThreadJoinInput, type AssistedSellingThreadJoinResult } from '../../../../commands/threads'

const logger = createLogger('assisted_selling').child({ component: 'api' })

// Step 5.3 (§6.1). `POST /threads/:id/join` — "Adds a `rep` participant. Visible to the buyer
// immediately (§8.3)." Refused under a live `mode` other than `rep` (§6.3 step 0's own "the
// same check gates ... `/threads:id/join`").

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
    assistedSellingThreadJoinRequestSchema.parse(rawBody)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationIds && organizationIds.length === 1 ? organizationIds[0] : (auth.orgId ?? null),
      organizationIds,
      request: req,
    }

    const commandInput: AssistedSellingThreadJoinInput = {
      tenantId: auth.tenantId,
      organizationIds,
      threadId: params.data.id,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingThreadJoinInput, AssistedSellingThreadJoinResult>(joinThreadCommand.id, {
      input: commandInput,
      ctx,
    })

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('assisted_selling.thread.join failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.unexpected', 'Unexpected error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Join a selling conversation',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Add the caller as a rep participant (§6.1)',
      description: 'Visible to the buyer immediately (§8.3, R3 — no store setting can suppress it).',
      responses: [{ status: 200, description: 'The participant row' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing required feature(s)' },
        { status: 404, description: 'Thread not found or outside the caller\'s organizations' },
        { status: 409, description: 'assisted_selling_unavailable' },
      ],
    },
  },
}
