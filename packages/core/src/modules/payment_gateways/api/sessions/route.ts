import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
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
  summary: 'Create a payment session via a gateway provider',
  methods: {
    POST: {
      summary: 'Create payment session',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 201, description: 'Payment session created' },
        { status: 422, description: 'Invalid payload or unknown provider' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
