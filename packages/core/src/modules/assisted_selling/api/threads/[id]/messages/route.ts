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
import { assistedSellingMessagePostRequestSchema } from '../../../../data/validators'
import { organizationIdsFromAssistedSellingScope } from '../../../../lib/organizationScope'
import { postMessageCommand, type AssistedSellingMessagePostInput, type AssistedSellingMessagePostResult } from '../../../../commands/messages'

const logger = createLogger('assisted_selling').child({ component: 'api' })

// Step 5.3 (§6.1). `POST /threads/:id/messages` — the console composer's own write path.
// `body_format: 'text'` only (S24).

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['assisted_selling.messages.post'] },
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
    const body = assistedSellingMessagePostRequestSchema.parse(rawBody)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationIds && organizationIds.length === 1 ? organizationIds[0] : (auth.orgId ?? null),
      organizationIds,
      request: req,
    }

    const commandInput: AssistedSellingMessagePostInput = {
      tenantId: auth.tenantId,
      organizationIds,
      threadId: params.data.id,
      body: body.body,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingMessagePostInput, AssistedSellingMessagePostResult>(
      postMessageCommand.id,
      { input: commandInput, ctx },
    )

    return NextResponse.json({ ok: true, result }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('assisted_selling.message.post failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.unexpected', 'Unexpected error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Post a message into a selling conversation',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Post a plain-text staff message (§6.1, S24)',
      requestBody: { contentType: 'application/json', schema: assistedSellingMessagePostRequestSchema },
      responses: [{ status: 201, description: 'The posted message' }],
      errors: [
        { status: 400, description: 'Invalid body — bodyFormat other than text' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing required feature(s)' },
        { status: 404, description: 'Thread not found or outside the caller\'s organizations' },
      ],
    },
  },
}
