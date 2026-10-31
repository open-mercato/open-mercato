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
import { assistedSellingProposalWithdrawRequestSchema } from '../../../../data/validators'
import { organizationIdsFromAssistedSellingScope } from '../../../../lib/organizationScope'
import {
  withdrawProposalCommand,
  type AssistedSellingProposalWithdrawInput,
  type AssistedSellingProposalWithdrawResult,
} from '../../../../commands/proposals'

const logger = createLogger('assisted_selling').child({ component: 'api' })

// Step 4.4 (§6.4). `POST /proposals/:id/withdraw` — withdraws a published proposal. Also
// rejects the proposal cart, through `cart.proposal.reject`, in the same command.

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['assisted_selling.proposals.author'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteParams = { params?: { id?: string } | Promise<{ id?: string }> }

export async function POST(req: Request, routeCtx: RouteParams) {
  const { translate } = await resolveTranslations()
  try {
    const params = paramsSchema.safeParse(await routeCtx.params)
    if (!params.success) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalid_proposal_id', 'Invalid proposal id') }, { status: 400 })
    }

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('assisted_selling.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromAssistedSellingScope(scope, scope?.selectedId ?? auth.orgId ?? null)

    const rawBody = await readJsonSafe<Record<string, unknown>>(req, {})
    const body = assistedSellingProposalWithdrawRequestSchema.parse(rawBody)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationIds && organizationIds.length === 1 ? organizationIds[0] : (auth.orgId ?? null),
      organizationIds,
      request: req,
    }

    const commandInput: AssistedSellingProposalWithdrawInput = {
      tenantId: auth.tenantId,
      organizationIds,
      proposalId: params.data.id,
      updatedAt: body.updatedAt,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingProposalWithdrawInput, AssistedSellingProposalWithdrawResult>(
      withdrawProposalCommand.id,
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
    logger.error('assisted_selling.proposal.withdraw failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.unexpected', 'Unexpected error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Withdraw a proposal',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Withdraw a published proposal (§6.4)',
      description: 'Only a published proposal can be withdrawn. Also rejects the proposal cart through cart.proposal.reject.',
      requestBody: { contentType: 'application/json', schema: assistedSellingProposalWithdrawRequestSchema },
      responses: [{ status: 200, description: 'The withdrawn proposal' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing assisted_selling.proposals.author' },
        { status: 404, description: 'Proposal not found or outside the caller\'s organizations' },
        { status: 409, description: 'proposal_not_live, or an optimistic-lock conflict' },
      ],
    },
  },
}
