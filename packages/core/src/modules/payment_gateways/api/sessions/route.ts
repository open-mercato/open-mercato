import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runApiInterceptorsAfter, runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createSessionSchema } from '../../data/validators'
import { GatewayPaymentLink } from '../../data/entities'
import { emitPaymentGatewayEvent } from '../../events'
import { buildPaymentLinkUrl, createPaymentLinkToken, hashPaymentLinkPassword } from '../../lib/payment-links'
import type { PaymentGatewayService } from '../../lib/gateway-service'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/sessions',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
}

const sessionRouteValidationDetailsSchema = z.object({
  formErrors: z.array(z.string()).optional(),
  fieldErrors: z.record(z.string(), z.array(z.string()).optional()).optional(),
})

const createPaymentSessionResponseSchema = z.object({
  transactionId: z.string().uuid(),
  sessionId: z.string(),
  providerKey: z.string(),
  clientSecret: z.string().nullable().optional(),
  redirectUrl: z.string().url().nullable().optional(),
  providerData: z.record(z.string(), z.unknown()).nullable(),
  status: z.string(),
  paymentId: z.string().uuid(),
  paymentLinkId: z.string().uuid().nullable(),
  paymentLinkToken: z.string().nullable(),
  paymentLinkUrl: z.string().url().nullable(),
})

const createPaymentSessionErrorSchema = z.object({
  error: z.string(),
  details: sessionRouteValidationDetailsSchema.optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})

const createPaymentSessionExample = {
  providerKey: 'stripe',
  amount: 49.99,
  currencyCode: 'USD',
  captureMethod: 'automatic',
  description: 'Invoice #INV-10024',
  successUrl: 'https://merchant.example.com/payments/success',
  cancelUrl: 'https://merchant.example.com/payments/cancel',
  metadata: {
    invoiceId: 'INV-10024',
    source: 'backoffice',
  },
  paymentLink: {
    enabled: true,
    title: 'Invoice INV-10024',
    description: 'Secure payment for invoice INV-10024.',
    password: '2486',
  },
}

const createPaymentSessionResponseExample = {
  transactionId: '123e4567-e89b-12d3-a456-426614174000',
  sessionId: 'cs_test_a1b2c3',
  providerKey: 'stripe',
  clientSecret: 'pi_3QzExample_secret_abc123',
  redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3',
  providerData: {
    paymentIntentId: 'pi_3QzExample',
    publishableKey: 'pk_test_123',
  },
  status: 'pending',
  paymentId: '123e4567-e89b-12d3-a456-426614174001',
  paymentLinkId: '123e4567-e89b-12d3-a456-426614174002',
  paymentLinkToken: 'pay_6NQ2gZf1wH7kPx',
  paymentLinkUrl: 'https://merchant.example.com/pay/pay_6NQ2gZf1wH7kPx',
}

const createPaymentSessionValidationErrorExample = {
  error: 'Invalid payload',
  fieldErrors: {
    paymentLinkTitle: 'Enter a title for the payment link.',
  },
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

function readRequestHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

function flattenFieldErrors(input: Record<string, string[] | undefined>): Record<string, string> | undefined {
  const result = Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, Array.isArray(value) ? value.filter(Boolean).join(' ') : ''])
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
  )
  return Object.keys(result).length > 0 ? result : undefined
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestHeaders = readRequestHeaders(req)
  const rawPayload = await readJsonSafe<unknown>(req)
  const requestPayload =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? rawPayload as Record<string, unknown>
      : {}

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const interceptorContext = {
    userId: auth.sub ?? '',
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
    em,
    container,
    userFeatures: resolveUserFeatures(auth),
  }
  const interceptedRequest = await runApiInterceptorsBefore({
    routePath: 'payment_gateways/sessions',
    method: 'POST',
    request: {
      method: 'POST',
      url: req.url,
      body: requestPayload,
      headers: requestHeaders,
    },
    context: interceptorContext,
  })
  if (!interceptedRequest.ok) {
    return NextResponse.json(interceptedRequest.body, { status: interceptedRequest.statusCode })
  }

  const parsed = createSessionSchema.safeParse(interceptedRequest.request.body ?? {})
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return NextResponse.json({
      error: 'Invalid payload',
      details: flattened,
      fieldErrors: flattenFieldErrors(flattened.fieldErrors),
    }, { status: 422 })
  }

  if (parsed.data.paymentLink?.enabled && !parsed.data.paymentLink.title?.trim()) {
    return NextResponse.json({
      error: 'Invalid payload',
      fieldErrors: {
        paymentLinkTitle: 'Enter a title for the payment link.',
      },
    }, { status: 422 })
  }

  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const guardValidation = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId as string,
    userId: auth.sub ?? '',
    resourceKind: 'payment_gateways.transaction',
    resourceId: 'create-session',
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as Record<string, unknown>,
  })
  if (guardValidation && !guardValidation.ok) {
    return NextResponse.json(guardValidation.body, { status: guardValidation.status })
  }

  try {
    const { transaction, session } = await service.createPaymentSession({
      providerKey: parsed.data.providerKey,
      paymentId: crypto.randomUUID(),
      orderId: parsed.data.orderId,
      amount: parsed.data.amount,
      currencyCode: parsed.data.currencyCode,
      captureMethod: parsed.data.captureMethod,
      description: parsed.data.description,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      metadata: parsed.data.metadata,
      providerInput: parsed.data.providerInput,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    let paymentLinkUrl: string | null = null
    let paymentLinkToken: string | null = null
    let paymentLinkId: string | null = null

    if (parsed.data.paymentLink?.enabled) {
      paymentLinkToken = createPaymentLinkToken()
      const paymentLink = em.create(GatewayPaymentLink, {
        transactionId: transaction.id,
        token: paymentLinkToken,
        providerKey: transaction.providerKey,
        title: parsed.data.paymentLink.title?.trim() || parsed.data.description?.trim() || `${transaction.providerKey} payment`,
        description: parsed.data.paymentLink.description?.trim() || null,
        passwordHash: parsed.data.paymentLink.password?.trim()
          ? await hashPaymentLinkPassword(parsed.data.paymentLink.password.trim())
          : null,
        status: 'active',
        metadata: {
          amount: parsed.data.amount,
          currencyCode: parsed.data.currencyCode,
        },
        organizationId: auth.orgId as string,
        tenantId: auth.tenantId,
      })
      await em.persistAndFlush(paymentLink)
      paymentLinkId = paymentLink.id
      paymentLinkUrl = buildPaymentLinkUrl(new URL(req.url).origin, paymentLinkToken)
    }

    const responseBody = {
      transactionId: transaction.id,
      sessionId: session.sessionId,
      providerKey: transaction.providerKey,
      clientSecret: session.clientSecret,
      redirectUrl: session.redirectUrl,
      providerData: session.providerData ?? null,
      status: session.status,
      paymentId: transaction.paymentId,
      paymentLinkId,
      paymentLinkToken,
      paymentLinkUrl,
    }

    if (paymentLinkId && paymentLinkToken) {
      await emitPaymentGatewayEvent('payment_gateways.payment_link.created', {
        paymentLinkId,
        paymentLinkToken,
        paymentLinkUrl,
        transactionId: transaction.id,
        paymentId: transaction.paymentId,
        providerKey: transaction.providerKey,
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })
    }

    if (guardValidation?.ok && guardValidation.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId as string,
        userId: auth.sub ?? '',
        resourceKind: 'payment_gateways.transaction',
        resourceId: transaction.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardValidation.metadata ?? null,
      })
    }

    const interceptedResponse = await runApiInterceptorsAfter({
      routePath: 'payment_gateways/sessions',
      method: 'POST',
      request: interceptedRequest.request,
      response: {
        statusCode: 201,
        body: responseBody,
        headers: {},
      },
      context: interceptorContext,
      metadataByInterceptor: interceptedRequest.metadataByInterceptor,
    })
    if (!interceptedResponse.ok) {
      return NextResponse.json(interceptedResponse.body, {
        status: interceptedResponse.statusCode,
        headers: interceptedResponse.headers,
      })
    }

    return NextResponse.json(interceptedResponse.body, {
      status: interceptedResponse.statusCode,
      headers: interceptedResponse.headers,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create payment session'
    const status = message.includes('No gateway adapter') ? 422 : 502
    return NextResponse.json({ error: message }, { status })
  }
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Create a payment transaction and optional pay-by-link session via a gateway provider',
  methods: {
    POST: {
      summary: 'Create payment transaction',
      tags: [paymentGatewaysTag],
      description: [
        'Creates a gateway transaction and returns the provider session details needed to complete checkout.',
        'Set `paymentLink.enabled` to `true` to also generate a shareable hosted payment-link URL.',
        'When pay-by-link mode is enabled, `paymentLink.title` is required and the response includes `paymentLinkId`, `paymentLinkToken`, and `paymentLinkUrl`.',
      ].join(' '),
      requestBody: {
        schema: createSessionSchema,
        description: 'Gateway transaction payload. Include the optional `paymentLink` object to create a public pay-by-link URL together with the transaction.',
        example: createPaymentSessionExample,
      },
      responses: [
        {
          status: 201,
          description: 'Payment transaction and provider session created',
          schema: createPaymentSessionResponseSchema,
          example: createPaymentSessionResponseExample,
        },
        {
          status: 401,
          description: 'Authentication required',
          schema: createPaymentSessionErrorSchema,
          example: { error: 'Unauthorized' },
        },
        {
          status: 422,
          description: 'Invalid payload, missing pay-link title, or unknown provider',
          schema: createPaymentSessionErrorSchema,
          example: createPaymentSessionValidationErrorExample,
        },
        {
          status: 502,
          description: 'Gateway provider error',
          schema: createPaymentSessionErrorSchema,
          example: { error: 'Failed to create payment session' },
        },
      ],
    },
  },
}
