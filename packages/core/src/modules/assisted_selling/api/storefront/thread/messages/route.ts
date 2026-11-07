import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
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
