import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolvePaymentLinkTemplate } from '@open-mercato/shared/modules/payment_link_pages/runtime'
import { GatewayPaymentLink } from '../data/entities'
import { paymentLinkInputSchema } from '../data/validators'
import {
  buildPaymentLinkUrl,
  createPaymentLinkToken,
  hashPaymentLinkPassword,
  isValidCustomPaymentLinkToken,
  normalizeCustomPaymentLinkToken,
} from '../lib/payment-links'
import { buildPaymentLinkStoredMetadata } from '../lib/payment-link-page-metadata'

type PaymentLinkTemplateData = {
  branding: unknown
  metadata: unknown
  customFields: unknown
  customFieldsetCode: string | null | undefined
  defaultTitle: string | null | undefined
  defaultDescription: string | null | undefined
  customerCapture: unknown
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
    customerHandlingMode: string | undefined
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
      customerHandlingMode?: string
    }
  },
  template: PaymentLinkTemplateData,
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
      customerHandlingMode: request.customerCapture?.customerHandlingMode
        ?? (typeof templateCapture?.customerHandlingMode === 'string' ? templateCapture.customerHandlingMode : undefined),
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

const sessionsInterceptor: ApiInterceptor = {
  id: 'payment_link_pages.sessions-interceptor',
  targetRoute: 'payment_gateways/sessions',
  methods: ['POST'],

  async before({ request, context }) {
    const body = request.body as Record<string, unknown> | undefined
    if (!body?.paymentLink) return { ok: true, request }

    const parsed = paymentLinkInputSchema.safeParse(body.paymentLink)
    if (!parsed.success || !parsed.data.enabled) {
      const strippedBody = { ...body }
      delete strippedBody.paymentLink
      return { ok: true, request: { ...request, body: strippedBody } }
    }

    const paymentLinkData = parsed.data

    if (!paymentLinkData.title?.trim() && !paymentLinkData.templateId) {
      return {
        ok: false,
        statusCode: 422,
        body: {
          error: 'Invalid payload',
          fieldErrors: {
            paymentLinkTitle: 'Enter a title for the payment link.',
          },
        },
      }
    }

    if (
      !paymentLinkData.templateId &&
      paymentLinkData.customerCapture?.enabled &&
      paymentLinkData.customerCapture.termsRequired === true &&
      !paymentLinkData.customerCapture.termsMarkdown?.trim()
    ) {
      return {
        ok: false,
        statusCode: 422,
        body: {
          error: 'Invalid payload',
          fieldErrors: {
            paymentLinkTermsMarkdown: 'Enter the markdown content that the customer must accept.',
          },
        },
      }
    }

    const paymentLinkTokenOverride = normalizeCustomPaymentLinkToken(paymentLinkData.token)
    if (paymentLinkTokenOverride && !isValidCustomPaymentLinkToken(paymentLinkTokenOverride)) {
      return {
        ok: false,
        statusCode: 422,
        body: {
          error: 'Invalid payload',
          fieldErrors: {
            paymentLinkCustomPath: 'Custom link path must use only letters, numbers, and dashes, and be 3 to 80 characters long.',
          },
        },
      }
    }

    if (paymentLinkTokenOverride && context.em) {
      const existingLink = await findOneWithDecryption(
        context.em,
        GatewayPaymentLink,
        {
          token: paymentLinkTokenOverride,
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          deletedAt: null,
        },
        undefined,
        { organizationId: context.organizationId, tenantId: context.tenantId },
      )
      if (existingLink) {
        return {
          ok: false,
          statusCode: 422,
          body: {
            error: 'Invalid payload',
            fieldErrors: {
              paymentLinkCustomPath: 'This custom link path is already in use.',
            },
          },
        }
      }
    }

    const strippedBody = { ...body }
    delete strippedBody.paymentLink
    return {
      ok: true,
      request: { ...request, body: strippedBody },
      metadata: { paymentLink: paymentLinkData, paymentLinkTokenOverride },
    }
  },

  async after({ request, response, context, metadata: interceptorMetadata }) {
    if (!interceptorMetadata?.paymentLink) return { ok: true, ...response }

    const paymentLinkData = interceptorMetadata.paymentLink as Record<string, unknown>
    if (!paymentLinkData.enabled) return { ok: true, ...response }

    if (response.statusCode < 200 || response.statusCode >= 300) return { ok: true, ...response }

    const responseBody = response.body as Record<string, unknown> | undefined
    if (!responseBody) return { ok: true, ...response }

    const em = context.em
    if (!em) return { ok: true, ...response }

    const paymentLinkTokenOverride = interceptorMetadata.paymentLinkTokenOverride as string | null
    const paymentLinkToken = paymentLinkTokenOverride ?? createPaymentLinkToken()
    const requestUrl = request.url ?? ''
    const origin = requestUrl ? new URL(requestUrl).origin : ''
    const paymentLinkUrl = buildPaymentLinkUrl(origin, paymentLinkToken)
    const isMultiUseLink = paymentLinkData.linkMode === 'multi'
    const transactionId = responseBody.transactionId as string | null

    const requestBody = request.body as Record<string, unknown>
    const providerKey = (requestBody.providerKey ?? responseBody.providerKey ?? '') as string
    const amount = (requestBody.amount ?? 0) as number
    const currencyCode = (requestBody.currencyCode ?? '') as string

    let resolvedTitle = (paymentLinkData.title as string)?.trim() || (requestBody.description as string)?.trim() || `${providerKey} payment`
    let resolvedDescription: string | null = (paymentLinkData.description as string)?.trim() || null
    let resolvedPageMetadata = paymentLinkData.metadata as Record<string, unknown> | undefined
    let resolvedCustomFields = paymentLinkData.customFields as Record<string, unknown> | undefined
    let resolvedCustomFieldsetCode: string | null = (paymentLinkData.customFieldsetCode as string) ?? null
    let resolvedCustomerCapture: { enabled: boolean; companyRequired: boolean; termsRequired: boolean; termsMarkdown: string | null; customerHandlingMode: string | undefined } | undefined

    const customerCaptureInput = paymentLinkData.customerCapture as Record<string, unknown> | undefined
    const rawHandlingMode = (customerCaptureInput?.customerHandlingMode as string) || undefined
    if (isMultiUseLink) {
      resolvedCustomerCapture = {
        enabled: true,
        companyRequired: customerCaptureInput?.companyRequired === true,
        termsRequired: customerCaptureInput?.termsRequired === true,
        termsMarkdown: customerCaptureInput?.termsRequired
          ? (customerCaptureInput?.termsMarkdown as string)?.trim() || null
          : null,
        customerHandlingMode: rawHandlingMode,
      }
    } else if (customerCaptureInput?.enabled) {
      resolvedCustomerCapture = {
        enabled: true,
        companyRequired: customerCaptureInput.companyRequired === true,
        termsRequired: customerCaptureInput.termsRequired === true,
        termsMarkdown: customerCaptureInput.termsRequired
          ? (customerCaptureInput.termsMarkdown as string)?.trim() || null
          : null,
        customerHandlingMode: rawHandlingMode,
      }
    }

    if (paymentLinkData.templateId) {
      const template = await resolvePaymentLinkTemplate(
        em,
        paymentLinkData.templateId as string,
        context.organizationId,
        context.tenantId,
      )

      if (template) {
        const merged = mergePaymentLinkWithTemplate(
          {
            title: paymentLinkData.title as string | undefined,
            description: paymentLinkData.description as string | undefined,
            metadata: paymentLinkData.metadata as Record<string, unknown> | undefined,
            customFields: paymentLinkData.customFields as Record<string, unknown> | undefined,
            customFieldsetCode: paymentLinkData.customFieldsetCode as string | undefined,
            customerCapture: customerCaptureInput as Record<string, unknown> | undefined,
          },
          template,
        )

        resolvedTitle = merged.title || (requestBody.description as string)?.trim() || `${providerKey} payment`
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
            customerHandlingMode: merged.customerCapture.customerHandlingMode,
          }
        }
      }
    }

    const storedMetadata = buildPaymentLinkStoredMetadata({
      amount,
      currencyCode,
      pageMetadata: resolvedPageMetadata,
      customFields: resolvedCustomFields,
      customFieldsetCode: resolvedCustomFieldsetCode,
      customerCapture: resolvedCustomerCapture,
      ...(isMultiUseLink ? {
        sessionParams: {
          providerKey,
          amount,
          currencyCode,
          captureMethod: requestBody.captureMethod as string | undefined,
          description: requestBody.description as string | undefined,
          successUrl: requestBody.successUrl as string | undefined,
          cancelUrl: requestBody.cancelUrl as string | undefined,
          metadata: requestBody.metadata as Record<string, unknown> | undefined,
          providerInput: requestBody.providerInput as Record<string, unknown> | undefined,
        },
      } : {}),
    })

    const paymentLink = em.create(GatewayPaymentLink, {
      transactionId: isMultiUseLink ? null : transactionId,
      token: paymentLinkToken,
      providerKey,
      title: resolvedTitle,
      description: resolvedDescription,
      linkMode: isMultiUseLink ? 'multi' : 'single',
      maxUses: isMultiUseLink ? (paymentLinkData.maxUses as number | undefined) ?? null : undefined,
      useCount: 0,
      passwordHash: (paymentLinkData.password as string)?.trim()
        ? await hashPaymentLinkPassword((paymentLinkData.password as string).trim())
        : null,
      status: 'active',
      metadata: storedMetadata,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
    })
    await em.persistAndFlush(paymentLink)

    const enrichedBody = {
      ...responseBody,
      paymentLinkId: paymentLink.id,
      paymentLinkToken,
      paymentLinkUrl,
      ...(isMultiUseLink ? { linkMode: 'multi' } : {}),
    }

    return {
      ok: true,
      statusCode: response.statusCode,
      body: enrichedBody,
      headers: response.headers,
    }
  },
}

const transactionDetailInterceptor: ApiInterceptor = {
  id: 'payment_link_pages.transaction-detail-enricher',
  targetRoute: 'payment_gateways/transactions/*',
  methods: ['GET'],

  async after({ request, response, context }) {
    if (response.statusCode !== 200) return { ok: true, ...response }

    const responseBody = response.body as Record<string, unknown> | undefined
    if (!responseBody?.transaction) return { ok: true, ...response }

    const transaction = responseBody.transaction as Record<string, unknown>
    const transactionId = transaction.id as string | undefined
    if (!transactionId) return { ok: true, ...response }

    const em = context.em
    if (!em) return { ok: true, ...response }

    const paymentLink = await findOneWithDecryption(
      em,
      GatewayPaymentLink,
      {
        transactionId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'desc' },
      },
      { organizationId: context.organizationId, tenantId: context.tenantId },
    )

    if (!paymentLink) return { ok: true, ...response }

    const requestUrl = request.url ?? ''
    const origin = requestUrl ? new URL(requestUrl).origin : ''
    const paymentLinkUrl = buildPaymentLinkUrl(origin, paymentLink.token)

    function toIsoString(value: unknown): string | null {
      if (!value) return null
      if (value instanceof Date) return value.toISOString()
      if (typeof value === 'string') {
        const parsed = new Date(value)
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
        return value
      }
      return null
    }

    const enrichedBody = {
      ...responseBody,
      paymentLink: {
        id: paymentLink.id,
        token: paymentLink.token,
        url: paymentLinkUrl,
        title: paymentLink.title,
        description: paymentLink.description ?? null,
        status: paymentLink.status,
        passwordProtected: Boolean(paymentLink.passwordHash),
        completedAt: toIsoString(paymentLink.completedAt),
        createdAt: toIsoString(paymentLink.createdAt),
        updatedAt: toIsoString(paymentLink.updatedAt),
      },
    }

    return {
      ok: true,
      statusCode: response.statusCode,
      body: enrichedBody,
      headers: response.headers,
    }
  },
}

export const interceptors: ApiInterceptor[] = [sessionsInterceptor, transactionDetailInterceptor]
