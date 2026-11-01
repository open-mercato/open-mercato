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
import { assistedSellingProposalAuthorRequestSchema } from '../../../../data/validators'
import { organizationIdsFromAssistedSellingScope } from '../../../../lib/organizationScope'
import {
  authorProposalCommand,
  type AssistedSellingProposalAuthorInput,
  type AssistedSellingProposalAuthorResponse,
} from '../../../../commands/proposals'

const logger = createLogger('assisted_selling').child({ component: 'api' })

// Step 4.4 (§6.3). `POST /threads/:id/proposals` — authors a proposal, wrapping
// `cart.proposal.create` through `assisted_selling.proposal.author`.

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['assisted_selling.proposals.author', 'cart.proposals.author'] },
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
    const body = assistedSellingProposalAuthorRequestSchema.parse(rawBody)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationIds && organizationIds.length === 1 ? organizationIds[0] : (auth.orgId ?? null),
      organizationIds,
      request: req,
    }

    const commandInput: AssistedSellingProposalAuthorInput = {
      tenantId: auth.tenantId,
      organizationIds,
      threadId: params.data.id,
      lines: body.lines,
      note: body.note,
      idempotencyKey: body.idempotencyKey,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingProposalAuthorInput, AssistedSellingProposalAuthorResponse>(
      authorProposalCommand.id,
      { input: commandInput, ctx },
    )

    return NextResponse.json(
      {
        proposalId: result.proposalId,
        proposalCartId: result.proposalCartId,
        messageId: result.messageId,
        expiresAt: result.expiresAt,
        rejectedLines: result.rejectedLines,
      },
      { status: result.replayed ? 200 : 201 },
    )
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('assisted_selling.proposal.author failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.unexpected', 'Unexpected error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Author a proposal on a thread',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Author a proposal (§6.3)',
      description: 'Wraps cart.proposal.create. The note is stored as the proposal\'s message body, encrypted, never on the cart (S19). Idempotent per (threadId, idempotencyKey) (S23).',
      requestBody: { contentType: 'application/json', schema: assistedSellingProposalAuthorRequestSchema },
      responses: [
        { status: 201, description: 'The newly authored proposal' },
        { status: 200, description: 'A replayed idempotency-key response' },
      ],
      errors: [
        { status: 400, description: 'Invalid body, or too_many_proposal_lines' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing required feature(s)' },
        { status: 404, description: 'Thread not found or not open' },
        { status: 409, description: 'assisted_selling_unavailable or idempotency_key_mismatch' },
        { status: 422, description: 'proposal_empty' },
        { status: 503, description: 'assortment_scope_unavailable' },
      ],
    },
  },
}
