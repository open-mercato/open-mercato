import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkoutSessionSubmitSchema } from '../../../../data/validators'
import type {
  CheckoutSessionSubmitCommandInput,
  CheckoutSessionSubmitStageResult,
} from '../../../../commands/submit'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../lib/currentSessionRoute'
import {
  buildCheckoutSessionScopedRateLimitKey,
  checkoutSessionSubmitIpRateLimitConfig,
  checkoutSubmitRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../../../../lib/rateLimiter'
import { hashCheckoutSessionToken } from '../../../../lib/sessionToken'
import { serializeCheckoutSession } from '../../../../lib/sessionView'
import { handleCheckoutRouteError } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

// Release 5, Step 4.2 (B.4, §7, §9's route table: `POST /sessions/current/submit`). Drives
// the FULL 1-8 submit sequence end to end in ONE call to `checkout.session.submit` —
// Step 4.1's own command is structured as a single function that now runs all eight steps
// (Step 4.2 extended it in place rather than splitting it into a second command), so this
// route is a thin HTTP adapter, the exact shape every sibling `/sessions/current/*` route
// in this file set already follows.
export const metadata = {
  path: '/checkout/sessions/current/submit',
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const token = readCheckoutSessionToken(req)
    if (!token) return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })

    const tokenHash = hashCheckoutSessionToken(token)
    // §13: "POST /sessions/current/submit (B.4) | 10/min per session, 60/min per IP |
    // fail-closed" — both buckets enforced, neither instead of the other.
    const perSessionLimited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutSubmitRateLimitConfig,
      namespace: 'checkout-session-submit',
      errorMessage: 'Too many submit attempts. Please try again later.',
      posture: 'fail-closed',
      keyOverride: buildCheckoutSessionScopedRateLimitKey('checkout-session-submit', tokenHash),
    })
    if (perSessionLimited) return perSessionLimited
    const perIpLimited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutSessionSubmitIpRateLimitConfig,
      namespace: 'checkout-session-submit-ip',
      errorMessage: 'Too many submit attempts. Please try again later.',
      posture: 'fail-closed',
    })
    if (perIpLimited) return perIpLimited

    // D-R5-33 (§9.0 "Binding on every route") is enforced inside `resolveCurrentSession`
    // itself — an identified session's token without the matching customer session
    // collapses to the SAME 404 as an unknown token, before any PII-bearing read.
    const resolved = await resolveCurrentSession(em, req, token)
    if (!resolved.ok) return resolved.response

    // §7.1 precondition 2 / §7.4: client-generated, required on every submit attempt.
    const idempotencyKey = req.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json({ error: '[internal] Idempotency-Key header is required' }, { status: 400 })
    }
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return NextResponse.json({ error: '[internal] Idempotency-Key must be between 16 and 128 characters' }, { status: 400 })
    }

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    let parsed: ReturnType<typeof checkoutSessionSubmitSchema.parse>
    try {
      parsed = checkoutSessionSubmitSchema.parse(rawBody)
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
    const input: CheckoutSessionSubmitCommandInput = {
      sessionId: resolved.session.id,
      tenantId: resolved.scope.tenantId,
      organizationId: resolved.scope.organizationId,
      idempotencyKey,
      paymentMethodCode: parsed.paymentMethodCode,
      poNumber: parsed.poNumber ?? null,
      request: req,
    }
    const { result } = await commandBus.execute<CheckoutSessionSubmitCommandInput, CheckoutSessionSubmitStageResult>(
      'checkout.session.submit',
      { input, ctx },
    )

    return NextResponse.json({
      session: serializeCheckoutSession(result.session, { includePii: true }),
      salesOrderId: result.salesOrderId,
      salesQuoteId: result.salesQuoteId,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  headers: z.object({
    'X-Checkout-Session-Token': z.string().optional(),
    'Idempotency-Key': z.string().optional(),
  }),
}
