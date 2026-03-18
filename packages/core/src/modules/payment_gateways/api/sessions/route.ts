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
import { PaymentLinkTemplate } from '../../../payment_link_pages/data/entities'
import { emitPaymentGatewayEvent } from '../../events'
import { buildPaymentLinkStoredMetadata } from '../../lib/payment-link-page-metadata'
import {
  buildPaymentLinkUrl,
  createPaymentLinkToken,
  hashPaymentLinkPassword,
  isValidCustomPaymentLinkToken,
  normalizeCustomPaymentLinkToken,
} from '../../lib/payment-links'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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
    token: 'invoice-inv-10024',
    metadata: {
      logoUrl: 'https://merchant.example.com/logo.svg',
      accentColor: '#0f766e',
    },
    customFieldsetCode: 'invoice',
    customFields: {
      supportEmail: 'billing@example.com',
      companyName: 'Acme Commerce Ltd',
    },
    customerCapture: {
      enabled: true,
      companyRequired: false,
      termsRequired: true,
      termsMarkdown: '## Terms\n\nI consent to the processing of my data for payment handling.',
    },
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

function mapCreateSessionFieldErrors(error: z.ZodError): Record<string, string> | undefined {
  const fieldErrors: Record<string, string> = {}

  error.issues.forEach((issue) => {
    const path = issue.path.join('.')

    switch (path) {
      case 'providerKey':
        fieldErrors.providerKey = 'Select provider'
        break
      case 'amount':
        fieldErrors.amount = 'Provider, amount, and currency are required.'
        break
      case 'currencyCode':
        fieldErrors.currencyCode = 'Provider, amount, and currency are required.'
        break
      case 'paymentLink.title':
        fieldErrors.paymentLinkTitle = 'Enter a title for the payment link.'
        break
      case 'paymentLink.description':
        fieldErrors.paymentLinkDescription = 'Link description must be 500 characters or fewer.'
        break
      case 'paymentLink.password':
        fieldErrors.paymentLinkPassword = 'Password must be at least 4 characters.'
        break
      case 'paymentLink.token':
        fieldErrors.paymentLinkCustomPath = 'Enter a valid custom link path.'
        break
      default:
        break
    }
  })

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined
}

function shallowMergeObjects(
  base: Record<string, unknown> | null | undefined,
  override: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  const baseObj = base && typeof base === 'object' && !Array.isArray(base) ? base : {}
  const overrideObj = override && typeof override === 'object' && !Array.isArray(override) ? override : {}
  const merged = { ...baseObj, ...overrideObj }
  return Object.keys(merged).length > 0 ? merged : undefined
}

type ResolvedPaymentLinkValues = {
  title: string | undefined
  description: string | undefined
  pageMetadata: Record<string, unknown> | undefined
  customFields: Record<string, unknown> | undefined
  customFieldsetCode: string | undefined
  customerCapture: {
    enabled: boolean
    companyRequired: boolean
    termsRequired: boolean
    termsMarkdown: string | undefined
  } | undefined
}

function mergePaymentLinkWithTemplate(
  request: {
    title?: string
    description?: string
    metadata?: Record<string, unknown>
    customFields?: Record<string, unknown>
    customFieldsetCode?: string
    customerCapture?: {
      enabled?: boolean
      companyRequired?: boolean
      termsRequired?: boolean
      termsMarkdown?: string
    }
  },
  template: PaymentLinkTemplate,
): ResolvedPaymentLinkValues {
  const templateBranding = template.branding && typeof template.branding === 'object' && !Array.isArray(template.branding)
    ? template.branding as Record<string, unknown>
    : {}
  const templateMetadata = template.metadata && typeof template.metadata === 'object' && !Array.isArray(template.metadata)
    ? template.metadata as Record<string, unknown>
    : {}
  const templatePageMetadata = shallowMergeObjects(templateBranding, templateMetadata)
  const pageMetadata = shallowMergeObjects(templatePageMetadata, request.metadata)

  const customFields = shallowMergeObjects(
    template.customFields as Record<string, unknown> | null | undefined,
    request.customFields,
  )

  const templateCapture = template.customerCapture && typeof template.customerCapture === 'object' && !Array.isArray(template.customerCapture)
    ? template.customerCapture as Record<string, unknown>
    : undefined

  let customerCapture: ResolvedPaymentLinkValues['customerCapture']
  if (request.customerCapture?.enabled || (templateCapture?.enabled === true && request.customerCapture?.enabled !== false)) {
    customerCapture = {
      enabled: true,
      companyRequired: request.customerCapture?.companyRequired
        ?? (templateCapture?.companyRequired === true),
      termsRequired: request.customerCapture?.termsRequired
        ?? (templateCapture?.termsRequired === true),
      termsMarkdown: request.customerCapture?.termsMarkdown
        ?? (typeof templateCapture?.termsMarkdown === 'string' ? templateCapture.termsMarkdown : undefined),
    }
  }

  return {
    title: request.title?.trim() || template.defaultTitle?.trim() || undefined,
    description: request.description?.trim() || template.defaultDescription?.trim() || undefined,
    pageMetadata,
    customFields,
    customFieldsetCode: request.customFieldsetCode?.trim() || template.customFieldsetCode?.trim() || undefined,
    customerCapture,
  }
}

function buildPaymentLinkReturnUrl(baseUrl: string, state: 'success' | 'cancelled'): string {
  const url = new URL(baseUrl)
  url.searchParams.set('checkout', state)
  return url.toString()
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
      fieldErrors: mapCreateSessionFieldErrors(parsed.error) ?? flattenFieldErrors(flattened.fieldErrors),
    }, { status: 422 })
  }

  if (parsed.data.paymentLink?.enabled && !parsed.data.paymentLink.title?.trim() && !parsed.data.paymentLink.templateId) {
    return NextResponse.json({
      error: 'Invalid payload',
      fieldErrors: {
        paymentLinkTitle: 'Enter a title for the payment link.',
      },
    }, { status: 422 })
  }
  if (
    parsed.data.paymentLink?.enabled &&
    !parsed.data.paymentLink.templateId &&
    parsed.data.paymentLink.customerCapture?.enabled &&
    parsed.data.paymentLink.customerCapture.termsRequired === true &&
    !parsed.data.paymentLink.customerCapture.termsMarkdown?.trim()
  ) {
    return NextResponse.json({
      error: 'Invalid payload',
      fieldErrors: {
        paymentLinkTermsMarkdown: 'Enter the markdown content that the customer must accept.',
      },
    }, { status: 422 })
  }

  const paymentLinkTokenOverride = normalizeCustomPaymentLinkToken(parsed.data.paymentLink?.token)
  if (parsed.data.paymentLink?.enabled && paymentLinkTokenOverride && !isValidCustomPaymentLinkToken(paymentLinkTokenOverride)) {
    return NextResponse.json({
      error: 'Invalid payload',
      fieldErrors: {
        paymentLinkCustomPath: 'Custom link path must use only letters, numbers, and dashes, and be 3 to 80 characters long.',
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
    let paymentLinkUrl: string | null = null
    let paymentLinkToken: string | null = null
    let paymentLinkId: string | null = null
    const isMultiUseLink = parsed.data.paymentLink?.enabled && parsed.data.paymentLink.linkMode === 'multi'

    if (parsed.data.paymentLink?.enabled) {
      if (paymentLinkTokenOverride) {
        const existingLink = await findOneWithDecryption(
          em,
          GatewayPaymentLink,
          {
            token: paymentLinkTokenOverride,
            organizationId: auth.orgId as string,
            tenantId: auth.tenantId,
            deletedAt: null,
          },
          undefined,
          { organizationId: auth.orgId as string, tenantId: auth.tenantId },
        )
        if (existingLink) {
          return NextResponse.json({
            error: 'Invalid payload',
            fieldErrors: {
              paymentLinkCustomPath: 'This custom link path is already in use.',
            },
          }, { status: 422 })
        }
      }
      paymentLinkToken = paymentLinkTokenOverride ?? createPaymentLinkToken()
      paymentLinkUrl = buildPaymentLinkUrl(new URL(req.url).origin, paymentLinkToken)
    }

    if (isMultiUseLink) {
      // Multi-use link: skip transaction creation, store session params for later replay
      const paymentLinkData = parsed.data.paymentLink!

      let resolvedTitle = paymentLinkData.title?.trim() || parsed.data.description?.trim() || `${parsed.data.providerKey} payment`
      let resolvedDescription: string | null = paymentLinkData.description?.trim() || null
      let resolvedPageMetadata = paymentLinkData.metadata
      let resolvedCustomFields = paymentLinkData.customFields
      let resolvedCustomFieldsetCode: string | null = paymentLinkData.customFieldsetCode ?? null
      // Force customerCapture.enabled for multi-use links (email is always required)
      let resolvedCustomerCapture: { enabled: boolean; companyRequired: boolean; termsRequired: boolean; termsMarkdown: string | null } = {
        enabled: true,
        companyRequired: paymentLinkData.customerCapture?.companyRequired === true,
        termsRequired: paymentLinkData.customerCapture?.termsRequired === true,
        termsMarkdown: paymentLinkData.customerCapture?.termsRequired
          ? paymentLinkData.customerCapture.termsMarkdown?.trim() || null
          : null,
      }

      if (paymentLinkData.templateId) {
        const template = await findOneWithDecryption(
          em,
          PaymentLinkTemplate,
          {
            id: paymentLinkData.templateId,
            organizationId: auth.orgId as string,
            tenantId: auth.tenantId,
            deletedAt: null,
          },
          undefined,
          { organizationId: auth.orgId as string, tenantId: auth.tenantId },
        )

        if (template) {
          const merged = mergePaymentLinkWithTemplate(
            {
              title: paymentLinkData.title,
              description: paymentLinkData.description,
              metadata: paymentLinkData.metadata,
              customFields: paymentLinkData.customFields,
              customFieldsetCode: paymentLinkData.customFieldsetCode,
              customerCapture: paymentLinkData.customerCapture,
            },
            template,
          )

          resolvedTitle = merged.title || parsed.data.description?.trim() || `${parsed.data.providerKey} payment`
          resolvedDescription = merged.description || null
          resolvedPageMetadata = merged.pageMetadata
          resolvedCustomFields = merged.customFields
          resolvedCustomFieldsetCode = merged.customFieldsetCode ?? null
          if (merged.customerCapture) {
            resolvedCustomerCapture = {
              enabled: true,
              companyRequired: merged.customerCapture.companyRequired,
              termsRequired: merged.customerCapture.termsRequired,
              termsMarkdown: merged.customerCapture.termsMarkdown?.trim() || null,
            }
          }
        }
      }

      const paymentLink = em.create(GatewayPaymentLink, {
        transactionId: null,
        token: paymentLinkToken as string,
        providerKey: parsed.data.providerKey,
        title: resolvedTitle,
        description: resolvedDescription,
        linkMode: 'multi',
        maxUses: paymentLinkData.maxUses ?? null,
        useCount: 0,
        passwordHash: paymentLinkData.password?.trim()
          ? await hashPaymentLinkPassword(paymentLinkData.password.trim())
          : null,
        status: 'active',
        metadata: buildPaymentLinkStoredMetadata({
          amount: parsed.data.amount,
          currencyCode: parsed.data.currencyCode,
          pageMetadata: resolvedPageMetadata,
          customFields: resolvedCustomFields,
          customFieldsetCode: resolvedCustomFieldsetCode,
          customerCapture: resolvedCustomerCapture,
          sessionParams: {
            providerKey: parsed.data.providerKey,
            amount: parsed.data.amount,
            currencyCode: parsed.data.currencyCode,
            captureMethod: parsed.data.captureMethod,
            description: parsed.data.description,
            successUrl: parsed.data.successUrl,
            cancelUrl: parsed.data.cancelUrl,
            metadata: parsed.data.metadata,
            providerInput: parsed.data.providerInput,
          },
        }),
        organizationId: auth.orgId as string,
        tenantId: auth.tenantId,
      })
      await em.persistAndFlush(paymentLink)
      paymentLinkId = paymentLink.id

      const responseBody = {
        transactionId: null,
        sessionId: null,
        providerKey: parsed.data.providerKey,
        clientSecret: null,
        redirectUrl: null,
        providerData: null,
        status: 'active',
        paymentId: null,
        paymentLinkId,
        paymentLinkToken,
        paymentLinkUrl,
        linkMode: 'multi' as const,
      }

      await emitPaymentGatewayEvent('payment_gateways.payment_link.created', {
        paymentLinkId,
        paymentLinkToken,
        paymentLinkUrl,
        transactionId: null,
        paymentId: null,
        providerKey: parsed.data.providerKey,
        organizationId: auth.orgId as string,
        tenantId: auth.tenantId,
      })

      if (guardValidation?.ok && guardValidation.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: auth.tenantId,
          organizationId: auth.orgId as string,
          userId: auth.sub ?? '',
          resourceKind: 'payment_gateways.transaction',
          resourceId: paymentLinkId,
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
    }

    // Single-use link (default) or no payment link: create transaction immediately
    const { transaction, session } = await service.createPaymentSession({
      providerKey: parsed.data.providerKey,
      paymentId: crypto.randomUUID(),
      orderId: parsed.data.orderId,
      amount: parsed.data.amount,
      currencyCode: parsed.data.currencyCode,
      captureMethod: parsed.data.captureMethod,
      description: parsed.data.description,
      successUrl: parsed.data.successUrl
        ?? (paymentLinkUrl ? buildPaymentLinkReturnUrl(paymentLinkUrl, 'success') : undefined),
      cancelUrl: parsed.data.cancelUrl
        ?? (paymentLinkUrl ? buildPaymentLinkReturnUrl(paymentLinkUrl, 'cancelled') : undefined),
      metadata: parsed.data.metadata,
      providerInput: parsed.data.providerInput,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    if (parsed.data.paymentLink?.enabled) {
      let resolvedTitle = parsed.data.paymentLink.title?.trim() || parsed.data.description?.trim() || `${transaction.providerKey} payment`
      let resolvedDescription: string | null = parsed.data.paymentLink.description?.trim() || null
      let resolvedPageMetadata = parsed.data.paymentLink.metadata
      let resolvedCustomFields = parsed.data.paymentLink.customFields
      let resolvedCustomFieldsetCode: string | null = parsed.data.paymentLink.customFieldsetCode ?? null
      let resolvedCustomerCapture: { enabled: boolean; companyRequired: boolean; termsRequired: boolean; termsMarkdown: string | null } | undefined =
        parsed.data.paymentLink.customerCapture?.enabled
          ? {
              enabled: true,
              companyRequired: parsed.data.paymentLink.customerCapture.companyRequired === true,
              termsRequired: parsed.data.paymentLink.customerCapture.termsRequired === true,
              termsMarkdown: parsed.data.paymentLink.customerCapture.termsRequired
                ? parsed.data.paymentLink.customerCapture.termsMarkdown?.trim() || null
                : null,
            }
          : undefined

      if (parsed.data.paymentLink.templateId) {
        const template = await findOneWithDecryption(
          em,
          PaymentLinkTemplate,
          {
            id: parsed.data.paymentLink.templateId,
            organizationId: auth.orgId as string,
            tenantId: auth.tenantId,
            deletedAt: null,
          },
          undefined,
          { organizationId: auth.orgId as string, tenantId: auth.tenantId },
        )

        if (template) {
          const merged = mergePaymentLinkWithTemplate(
            {
              title: parsed.data.paymentLink.title,
              description: parsed.data.paymentLink.description,
              metadata: parsed.data.paymentLink.metadata,
              customFields: parsed.data.paymentLink.customFields,
              customFieldsetCode: parsed.data.paymentLink.customFieldsetCode,
              customerCapture: parsed.data.paymentLink.customerCapture,
            },
            template,
          )

          resolvedTitle = merged.title || parsed.data.description?.trim() || `${transaction.providerKey} payment`
          resolvedDescription = merged.description || null
          resolvedPageMetadata = merged.pageMetadata
          resolvedCustomFields = merged.customFields
          resolvedCustomFieldsetCode = merged.customFieldsetCode ?? null
          resolvedCustomerCapture = merged.customerCapture
            ? {
                enabled: merged.customerCapture.enabled,
                companyRequired: merged.customerCapture.companyRequired,
                termsRequired: merged.customerCapture.termsRequired,
                termsMarkdown: merged.customerCapture.termsMarkdown?.trim() || null,
              }
            : undefined
        }
      }

      const paymentLink = em.create(GatewayPaymentLink, {
        transactionId: transaction.id,
        token: paymentLinkToken as string,
        providerKey: transaction.providerKey,
        title: resolvedTitle,
        description: resolvedDescription,
        passwordHash: parsed.data.paymentLink.password?.trim()
          ? await hashPaymentLinkPassword(parsed.data.paymentLink.password.trim())
          : null,
        status: 'active',
        metadata: buildPaymentLinkStoredMetadata({
          amount: parsed.data.amount,
          currencyCode: parsed.data.currencyCode,
          pageMetadata: resolvedPageMetadata,
          customFields: resolvedCustomFields,
          customFieldsetCode: resolvedCustomFieldsetCode,
          customerCapture: resolvedCustomerCapture,
        }),
        organizationId: auth.orgId as string,
        tenantId: auth.tenantId,
      })
      await em.persistAndFlush(paymentLink)
      paymentLinkId = paymentLink.id
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
