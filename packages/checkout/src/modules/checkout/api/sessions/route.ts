import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CheckoutSession } from '../../data/entities'
import { checkoutSessionCreateSchema } from '../../data/validators'
import type { CheckoutSessionCreateCommandInput, CheckoutSessionCreateResult } from '../../commands/session'
import { createSessionCommand } from '../../commands/session'
import { CART_TOKEN_HEADER, readCartTokenHeader } from '../../lib/cartPeer'
import {
  checkoutSessionCreateRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../../lib/rateLimiter'
import { serializeCheckoutSession } from '../../lib/sessionView'
import { handleCheckoutRouteError, requireAdminContext, userHasCheckoutFeature } from '../helpers'
import { checkoutTag } from '../openapi'

// Release 5, Step 2.12 (B.1). Admin `GET` (staff auth, `checkout.sessions.view`, §9.1) and
// buyer `POST` (anonymous, token-bound per §9.0) share this path — the literal `current`
// segment is routed before `[id]` (§9.0's own "route resolution" note, the cart's D-R4-6
// split), so these two never collide with `GET /sessions/[id]` or the buyer `/current/*`
// family.
export const metadata = {
  path: '/checkout/sessions',
  GET: { requireAuth: true, requireFeatures: ['checkout.sessions.view'] },
  POST: { requireAuth: false },
}

export async function GET(req: Request) {
  try {
    const { auth, container, em } = await requireAdminContext(req)
    const canViewPii = await userHasCheckoutFeature(container, auth, 'checkout.viewPii')
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')))
    const status = url.searchParams.get('status')
    const where: Record<string, unknown> = {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    }
    if (status) where.status = status
    const [items, total] = await findAndCountWithDecryption(
      em,
      CheckoutSession,
      where,
      {
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    return NextResponse.json({
      items: items.map((item) => serializeCheckoutSession(item, { includePii: canViewPii })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      canViewPii,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()

    const rateLimited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutSessionCreateRateLimitConfig,
      namespace: 'checkout-session-create',
      errorMessage: 'Too many checkout session requests. Please try again later.',
      posture: 'fail-closed',
    })
    if (rateLimited) return rateLimited

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    let parsed: z.infer<typeof checkoutSessionCreateSchema>
    try {
      parsed = checkoutSessionCreateSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    let input: CheckoutSessionCreateCommandInput
    if (parsed.source === 'cart') {
      const cartToken = readCartTokenHeader(req)
      if (!cartToken) {
        return NextResponse.json(
          { error: `[internal] ${CART_TOKEN_HEADER} header is required`, code: 'cart_not_found' },
          { status: 404 },
        )
      }
      input = { source: 'cart', cartToken, request: req }
    } else {
      input = { source: 'link', slug: parsed.slug, request: req }
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      request: req,
    }
    const { result } = await commandBus.execute<CheckoutSessionCreateCommandInput, CheckoutSessionCreateResult>(
      createSessionCommand.id,
      { input, ctx },
    )

    return NextResponse.json(
      {
        token: result.token,
        session: serializeCheckoutSession(result.session, { includePii: true }),
      },
      { status: 201 },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}
