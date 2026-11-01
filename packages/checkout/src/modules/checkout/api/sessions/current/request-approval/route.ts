import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type {
  CheckoutSessionRequestApprovalCommandInput,
  CheckoutSessionRequestApprovalResult,
} from '../../../../commands/approval'
import { requestApprovalCommand } from '../../../../commands/approval'
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

// Release 5, Step 5.2 (C11, §8.2 step 1, §9's own route table: `POST /sessions/current/
// request-approval`). No request body — "the amount comes from the cart's server-side
// totals (K1 basis), never from the request body" (§8.2 step 1). §13's rate-limit table
// has no dedicated bucket for this route, so it falls into the generic "PATCH/POST under
// /sessions/current" row, the SAME 60/min-per-session + 120/min-per-IP fail-closed pair
// Step 2.12 built for PATCH /current and Step 2.13 reused for POST /current/delivery —
// never `submit`'s own stricter 10/60 pair, which §13 names for that one route only.
export const metadata = {
  path: '/checkout/sessions/current/request-approval',
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

    // D-R5-33 (§9.0 "Binding on every route") is enforced inside `resolveCurrentSession`
    // itself — an identified session's token without the matching customer session
    // collapses to the SAME 404 as an unknown token, before any PII-bearing read.
    const resolved = await resolveCurrentSession(em, req, token)
    if (!resolved.ok) return resolved.response

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: resolved.scope.organizationId,
      organizationIds: null,
      request: req,
    }
    const input: CheckoutSessionRequestApprovalCommandInput = {
      sessionId: resolved.session.id,
      tenantId: resolved.scope.tenantId,
      organizationId: resolved.scope.organizationId,
    }
    const { result } = await commandBus.execute<
      CheckoutSessionRequestApprovalCommandInput,
      CheckoutSessionRequestApprovalResult
    >(requestApprovalCommand.id, { input, ctx })

    return NextResponse.json({
      session: serializeCheckoutSession(result.session, { includePii: true }),
      approvalId: result.approvalId,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  headers: z.object({ 'X-Checkout-Session-Token': z.string().optional() }),
}
