import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkoutSessionUpdateSchema } from '../../../data/validators'
import type { CheckoutSessionUpdateCommandInput, CheckoutSessionUpdateResult } from '../../../commands/session'
import { updateSessionCommand } from '../../../commands/session'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../lib/currentSessionRoute'
import {
  buildCheckoutSessionScopedRateLimitKey,
  checkoutSessionMutateIpRateLimitConfig,
  checkoutSessionMutateSessionRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../../../lib/rateLimiter'
import { hashCheckoutSessionToken } from '../../../lib/sessionToken'
import { serializeCheckoutSession } from '../../../lib/sessionView'
import { handleCheckoutRouteError } from '../../helpers'
import { checkoutTag } from '../../openapi'

// Release 5, Step 2.12 (B.1, §9.0). Anonymous, token-bound (`X-Checkout-Session-Token`,
// never a path segment or query string, C4) — binding (D-R5-33) and cross-tenant scope
// (C21) are both enforced inside `resolveCurrentSession` before any PII-bearing read.
export const metadata = {
  path: '/checkout/sessions/current',
  GET: { requireAuth: false },
  PATCH: { requireAuth: false },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const token = readCheckoutSessionToken(req)
    if (!token) return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })

    const resolved = await resolveCurrentSession(em, req, token)
    if (!resolved.ok) return resolved.response

    return NextResponse.json({ session: serializeCheckoutSession(resolved.session, { includePii: true }) })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function PATCH(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const token = readCheckoutSessionToken(req)
    if (!token) return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })

    const tokenHash = hashCheckoutSessionToken(token)
    // §13: "60/min per session, 120/min per IP" — BOTH buckets apply to every `/current`
    // mutation, not either/or.
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
    let patch: ReturnType<typeof checkoutSessionUpdateSchema.parse>
    try {
      patch = checkoutSessionUpdateSchema.parse(rawBody)
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
    const input: CheckoutSessionUpdateCommandInput = {
      sessionId: resolved.session.id,
      tenantId: resolved.scope.tenantId,
      organizationId: resolved.scope.organizationId,
      patch,
    }
    const { result } = await commandBus.execute<CheckoutSessionUpdateCommandInput, CheckoutSessionUpdateResult>(
      updateSessionCommand.id,
      { input, ctx },
    )

    return NextResponse.json({ session: serializeCheckoutSession(result.session, { includePii: true }) })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  headers: z.object({ 'X-Checkout-Session-Token': z.string().optional() }),
}
