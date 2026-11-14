import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { assistedSellingBuyerMessagePostRequestSchema } from '../../../../data/validators'
import {
  mapAssistedSellingBuyerRouteError,
  notFoundThreadResponse,
  readAssistedSellingCartToken,
  resolveIdentifiedBuyerBasket,
} from '../../../../lib/buyerIdentity'
import { enforceAssistedSellingBuyerRateLimit } from '../../../../lib/rateLimit'
import {
  postMessageAsBuyerCommand,
  type AssistedSellingMessagePostAsBuyerInput,
  type AssistedSellingMessagePostAsBuyerResult,
} from '../../../../commands/buyerThread'
import { ASSISTED_SELLING_THREAD_RESOURCE_KIND } from '../../../../commands/shared'

// Step 4.5 (§6.2). `POST /api/assisted_selling/storefront/thread/messages` — buyer posts a
// message. `body_format: 'text'` only (S24); `404` when the basket has no open thread; no
// live-mode check (§8.4: "works on an open thread after the store moved to off").

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(request: Request) {
  try {
    const container = await createRequestContainer()
    const token = readAssistedSellingCartToken(request)

    const limited = await enforceAssistedSellingBuyerRateLimit(container, request, 'message', token)
    if (limited) return limited
    if (!token) return notFoundThreadResponse()

    const basket = await resolveIdentifiedBuyerBasket(container, request, token)
    if (!basket) return notFoundThreadResponse()

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    let body: z.infer<typeof assistedSellingBuyerMessagePostRequestSchema>
    try {
      body = assistedSellingBuyerMessagePostRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    // #8268 review Major 7: this write dispatched `assisted_selling.message.post_as_buyer`
    // without going through the shared route mutation-guard registry at all, so an
    // unconditional denial/transform guard registered for `assisted_selling.thread`
    // (enforced on the staff `/threads/:id/messages` path) never ran for a direct buyer
    // call. `userFeatures: []` is deliberate, same as `cart/api/current/route.ts`'s own
    // buyer-route convention — `basket.customerUserId` is a
    // `customer_accounts.CustomerUser.id`, not an `auth.User.id`, so `rbacService` must
    // never be asked to resolve grants for it.
    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: basket.customerUserId ?? 'anonymous',
        tenantId: basket.tenantId,
        organizationId: basket.organizationId,
        userFeatures: [],
      },
      input: {
        resourceKind: ASSISTED_SELLING_THREAD_RESOURCE_KIND,
        resourceId: null,
        operation: 'create',
        mutationPayload: body,
      },
    })
    if (!guarded.ok) return guarded.response
    if (guarded.modifiedPayload) {
      body = assistedSellingBuyerMessagePostRequestSchema.parse({ ...body, ...guarded.modifiedPayload })
    }

    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: basket.organizationId,
      organizationIds: null,
      request,
    }
    const commandInput: AssistedSellingMessagePostAsBuyerInput = {
      tenantId: basket.tenantId,
      organizationId: basket.organizationId,
      buyerCartId: basket.id,
      customerUserId: basket.customerUserId,
      body: body.body,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingMessagePostAsBuyerInput, AssistedSellingMessagePostAsBuyerResult>(
      postMessageAsBuyerCommand.id,
      { input: commandInput, ctx },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, result }, { status: 201 })
  } catch (error) {
    return mapAssistedSellingBuyerRouteError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Buyer posts a message on the current basket\'s thread',
  methods: {
    POST: {
      summary: 'Post a buyer message (§6.2)',
      description: 'text only (S24). 404 when the basket has no open thread.',
      requestBody: { contentType: 'application/json', schema: assistedSellingBuyerMessagePostRequestSchema },
      responses: [{ status: 201, description: 'The posted message id' }],
      errors: [
        { status: 400, description: 'Invalid body, or body_format other than text' },
        { status: 404, description: 'No/unknown token, identity-binding mismatch, or no open thread' },
        { status: 429, description: 'Rate limited' },
      ],
    },
  },
}
