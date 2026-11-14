import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkoutSessionDeliverySelectSchema } from '../../../../data/validators'
import type {
  CheckoutSessionSelectDeliveryCommandInput,
  CheckoutSessionSelectDeliveryResult,
} from '../../../../commands/delivery'
import { selectDeliveryCommand } from '../../../../commands/delivery'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../lib/currentSessionRoute'
import {
  buildCheckoutSessionScopedRateLimitKey,
  checkoutSessionMutateIpRateLimitConfig,
  checkoutSessionMutateSessionRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../../../../lib/rateLimiter'
import { hashCheckoutSessionToken } from '../../../../lib/sessionToken'
import { serializeCheckoutSession } from '../../../../lib/sessionView'
import { handleCheckoutRouteError } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

// Release 5, Step 2.13 (B.3, §5.3/§5.4, §9's route table: `POST /sessions/current/
// delivery`). Same C14/§13 mutation rate-limit pair Step 2.12 built for every
// `PATCH`/`POST` under `/sessions/current` (60/min per session + 120/min per IP,
// fail-closed) — this route is an additive member of that family, not a new bucket.
export const metadata = {
  path: '/checkout/sessions/current/delivery',
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const token = readCheckoutSessionToken(req)
    if (!token) return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })

    const tokenHash = hashCheckoutSessionToken(token)
    const perSessionLimited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutSessionMutateSessionRateLimitConfig,
      namespace: 'checkout-session-mutate',
      errorMessage: 'Too many checkout session updates. Please try again later.',
      posture: 'fail-closed',
      keyOverride: buildCheckoutSessionScopedRateLimitKey('checkout-session-mutate', tokenHash),
    })
    if (perSessionLimited) return perSessionLimited
    const perIpLimited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutSessionMutateIpRateLimitConfig,
      namespace: 'checkout-session-mutate-ip',
      errorMessage: 'Too many checkout session updates. Please try again later.',
      posture: 'fail-closed',
    })
    if (perIpLimited) return perIpLimited

    const resolved = await resolveCurrentSession(em, req, token)
    if (!resolved.ok) return resolved.response

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    let parsed: ReturnType<typeof checkoutSessionDeliverySelectSchema.parse>
    try {
      parsed = checkoutSessionDeliverySelectSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: resolved.scope.organizationId,
      organizationIds: null,
      request: req,
    }
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: resolved.session.id,
      tenantId: resolved.scope.tenantId,
      organizationId: resolved.scope.organizationId,
      deliveryMethodCode: parsed.deliveryMethodCode,
    }
    const { result } = await commandBus.execute<
      CheckoutSessionSelectDeliveryCommandInput,
      CheckoutSessionSelectDeliveryResult
    >(selectDeliveryCommand.id, { input, ctx })

    return NextResponse.json({
      session: serializeCheckoutSession(result.session, { includePii: true }),
      deliveryDiscount: result.deliveryDiscount,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  headers: z.object({ 'X-Checkout-Session-Token': z.string().optional() }),
}
