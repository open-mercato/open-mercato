import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createGatewaySession } from '@open-mercato/core/modules/payment_gateways/lib/payment-gateway-service'
import { stripeGatewaySettingsSchema } from '../../../../../data/validators'

const requestSchema = z.object({
  amount: z.coerce.number().positive().max(999999),
  currencyCode: z.string().trim().length(3).default('USD'),
  orderId: z.string().trim().optional(),
  orderNumber: z.string().trim().optional(),
  customerEmail: z.string().trim().email().optional(),
  customerName: z.string().trim().optional(),
  successUrl: z.string().trim().url().optional(),
  cancelUrl: z.string().trim().url().optional(),
  locale: z.string().trim().optional(),
  paymentMethodTypes: z.array(z.string().trim().min(1)).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  settings: stripeGatewaySettingsSchema.partial().optional(),
  lineItems: z.array(z.object({
    name: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1).default(1),
    amount: z.coerce.number().positive(),
  })).optional(),
})

const responseSchema = z.object({
  sessionId: z.string(),
  redirectUrl: z.string().url(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['gateway_stripe.checkout'] },
} as const

function fallbackUrl(req: Request, path: string): string {
  const url = new URL(req.url)
  return new URL(path, `${url.protocol}//${url.host}`).toString()
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!auth.tenantId) {
    return NextResponse.json({ error: 'Tenant context is required' }, { status: 400 })
  }
  if (!auth.orgId) {
    return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  try {
    const input = parsed.data
    const successUrl = input.successUrl || process.env.STRIPE_CHECKOUT_SUCCESS_URL || fallbackUrl(req, '/backend/stripe-demo?status=success')
    const cancelUrl = input.cancelUrl || process.env.STRIPE_CHECKOUT_CANCEL_URL || fallbackUrl(req, '/backend/stripe-demo?status=cancelled')

    const session = await createGatewaySession('stripe', {
      amount: input.amount,
      currencyCode: input.currencyCode.toUpperCase(),
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      lineItems: input.lineItems,
      settings: input.settings ?? {},
      successUrl,
      cancelUrl,
      webhookUrl: process.env.STRIPE_WEBHOOK_URL,
      paymentMethodTypes: input.paymentMethodTypes,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      locale: input.locale,
      metadata: input.metadata,
    }, '2024-12-18')

    if (!session.redirectUrl) {
      return NextResponse.json({ error: 'Stripe did not return a checkout URL.' }, { status: 502 })
    }

    const container = await createRequestContainer()
    const gatewayTransactionService = container.resolve('gatewayTransactionService') as {
      createOrUpdateFromSession: (input: {
        providerKey: string
        providerVersion?: string | null
        paymentId?: string | null
        orderId?: string | null
        providerSessionId: string
        amount: number
        currencyCode: string
        providerStatus?: string | null
        unifiedStatus?: string | null
        providerData?: Record<string, unknown> | null
        tenantId: string
        organizationId: string
      }) => Promise<unknown>
    }

    await gatewayTransactionService.createOrUpdateFromSession({
      providerKey: 'stripe',
      providerVersion: '2024-12-18',
      paymentId: typeof input.metadata?.paymentId === 'string' ? input.metadata.paymentId : null,
      orderId: input.orderId ?? null,
      providerSessionId: session.sessionId,
      amount: input.amount,
      currencyCode: input.currencyCode.toUpperCase(),
      providerStatus: session.gatewayStatus ?? null,
      unifiedStatus: session.unifiedStatus ?? null,
      providerData: session.providerData ?? null,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    return NextResponse.json(
      responseSchema.parse({ sessionId: session.sessionId, redirectUrl: session.redirectUrl }),
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Stripe checkout session'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payment Gateways',
  summary: 'Create Stripe Checkout session',
  methods: {
    POST: {
      summary: 'Create hosted Stripe checkout session',
      description: 'Creates a Stripe Checkout session and returns a redirect URL for payment.',
      requestBody: {
        schema: requestSchema,
        description: 'Stripe checkout session request body.',
      },
      responses: [
        { status: 201, description: 'Checkout session created', schema: responseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required' },
        { status: 422, description: 'Validation failed' },
        { status: 502, description: 'Gateway error' },
      ],
    },
  },
}
