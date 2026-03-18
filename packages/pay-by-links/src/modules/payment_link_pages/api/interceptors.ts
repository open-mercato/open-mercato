import type { ApiInterceptor, InterceptorAfterResult, InterceptorContext, InterceptorRequest, InterceptorResponse } from '@open-mercato/shared/lib/crud/api-interceptor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolvePaymentLinkTemplate, type PaymentLinkTemplateData } from '@open-mercato/shared/modules/payment_link_pages/runtime'
import { GatewayTransaction } from '@open-mercato/core/modules/payment_gateways/data/entities'
import { GatewayPaymentLink, GatewayPaymentLinkTransaction } from '../data/entities'
import { paymentLinkInputSchema } from '../data/validators'
import {
  buildPaymentLinkUrl,
  createPaymentLinkToken,
  hashPaymentLinkPassword,
  isValidCustomPaymentLinkToken,
  normalizeCustomPaymentLinkToken,
} from '../lib/payment-links'
import { buildPaymentLinkStoredMetadata } from '../lib/payment-link-page-metadata'
import type { CustomerHandlingMode, AmountType, AmountOption } from '../lib/payment-link-page-metadata'

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
    customerHandlingMode: CustomerHandlingMode | undefined
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
      customerHandlingMode?: CustomerHandlingMode
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
        ?? (typeof templateCapture?.customerHandlingMode === 'string' ? templateCapture.customerHandlingMode as CustomerHandlingMode : undefined),
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

const sessionsInterceptor: ApiInterceptor = {
  id: 'payment_link_pages.sessions-interceptor',
  targetRoute: 'payment_gateways/sessions',
  methods: ['POST'],

  async before(request: InterceptorRequest, context: InterceptorContext) {
    const body = request.body as Record<string, unknown> | undefined
    if (!body?.paymentLink) return { ok: true }

    const parsed = paymentLinkInputSchema.safeParse(body.paymentLink)
    if (!parsed.success || !parsed.data.enabled) {
      const strippedBody = { ...body }
      delete strippedBody.paymentLink
      return { ok: true, body: strippedBody }
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
      body: strippedBody,
      metadata: { paymentLink: paymentLinkData, paymentLinkTokenOverride },
    }
  },

  async after(request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext): Promise<InterceptorAfterResult> {
    const interceptorMetadata = context.metadata
    if (!interceptorMetadata?.paymentLink) return {}

    const paymentLinkData = interceptorMetadata.paymentLink as Record<string, unknown>
    if (!paymentLinkData.enabled) return {}

    if (response.statusCode < 200 || response.statusCode >= 300) return {}

    const responseBody = response.body as Record<string, unknown> | undefined
    if (!responseBody) return {}

    const em = context.em
    if (!em) return {}

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
    let resolvedAmountType: AmountType = (paymentLinkData.amountType as AmountType) ?? 'fixed'
    let resolvedAmountOptions: AmountOption[] | undefined = Array.isArray(paymentLinkData.amountOptions)
      ? (paymentLinkData.amountOptions as AmountOption[]).filter(opt => opt.amount > 0 && opt.label?.trim())
      : undefined
    let resolvedCustomerCapture: { enabled: boolean; companyRequired: boolean; termsRequired: boolean; termsMarkdown: string | null; customerHandlingMode: CustomerHandlingMode | undefined } | undefined

    const customerCaptureInput = paymentLinkData.customerCapture as Record<string, unknown> | undefined
    const rawHandlingMode = (customerCaptureInput?.customerHandlingMode as CustomerHandlingMode) || undefined
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
        if (resolvedAmountType === 'fixed' && template.amountType && template.amountType !== 'fixed') {
          resolvedAmountType = template.amountType as AmountType
        }
        if (!resolvedAmountOptions?.length && Array.isArray(template.amountOptions) && template.amountOptions.length > 0) {
          resolvedAmountOptions = template.amountOptions
        }
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
      amountType: resolvedAmountType,
      amountOptions: resolvedAmountOptions,
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

    if (transactionId) {
      const transaction = await findOneWithDecryption(
        em,
        GatewayTransaction,
        { id: transactionId, organizationId: context.organizationId, tenantId: context.tenantId, deletedAt: null },
        undefined,
        { organizationId: context.organizationId, tenantId: context.tenantId },
      )
      if (transaction) {
        transaction.documentType = 'payment_link_pages:gateway_payment_link'
        transaction.documentId = paymentLink.id
        await em.flush()
      }
    }

    return {
      merge: {
        paymentLinkId: paymentLink.id,
        paymentLinkToken,
        paymentLinkUrl,
        ...(isMultiUseLink ? { linkMode: 'multi' } : {}),
      },
    }
  },
}

const transactionDetailInterceptor: ApiInterceptor = {
  id: 'payment_link_pages.transaction-detail-enricher',
  targetRoute: 'payment_gateways/transactions/*',
  methods: ['GET'],

  async after(request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext): Promise<InterceptorAfterResult> {
    if (response.statusCode !== 200) return {}

    const responseBody = response.body as Record<string, unknown> | undefined
    if (!responseBody?.transaction) return {}

    const transaction = responseBody.transaction as Record<string, unknown>
    const transactionId = transaction.id as string | undefined
    if (!transactionId) return {}

    const em = context.em
    if (!em) return {}

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

    if (!paymentLink) {
      const linkTransaction = await findOneWithDecryption(
        em,
        GatewayPaymentLinkTransaction,
        { transactionId },
        { orderBy: { createdAt: 'desc' } },
        { organizationId: context.organizationId, tenantId: context.tenantId },
      )
      if (!linkTransaction) return {}

      const parentLink = await findOneWithDecryption(
        em,
        GatewayPaymentLink,
        {
          id: linkTransaction.paymentLinkId,
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          deletedAt: null,
        },
        undefined,
        { organizationId: context.organizationId, tenantId: context.tenantId },
      )

      const requestUrl = request.url ?? ''
      const origin = requestUrl ? new URL(requestUrl).origin : ''

      return {
        merge: {
          paymentLink: parentLink ? {
            id: parentLink.id,
            token: parentLink.token,
            url: buildPaymentLinkUrl(origin, parentLink.token),
            title: parentLink.title,
            description: parentLink.description ?? null,
            status: parentLink.status,
            linkMode: parentLink.linkMode,
            passwordProtected: Boolean(parentLink.passwordHash),
            completedAt: toIsoString(parentLink.completedAt),
            createdAt: toIsoString(parentLink.createdAt),
            updatedAt: toIsoString(parentLink.updatedAt),
          } : null,
          paymentLinkCustomerData: {
            customerEmail: linkTransaction.customerEmail,
            ...(linkTransaction.customerData ?? {}),
          },
        },
      }
    }

    const requestUrl = request.url ?? ''
    const origin = requestUrl ? new URL(requestUrl).origin : ''
    const paymentLinkUrl = buildPaymentLinkUrl(origin, paymentLink.token)

    const linkTransaction = await findOneWithDecryption(
      em,
      GatewayPaymentLinkTransaction,
      { transactionId },
      { orderBy: { createdAt: 'desc' } },
      { organizationId: context.organizationId, tenantId: context.tenantId },
    )

    return {
      merge: {
        paymentLink: {
          id: paymentLink.id,
          token: paymentLink.token,
          url: paymentLinkUrl,
          title: paymentLink.title,
          description: paymentLink.description ?? null,
          status: paymentLink.status,
          linkMode: paymentLink.linkMode,
          passwordProtected: Boolean(paymentLink.passwordHash),
          completedAt: toIsoString(paymentLink.completedAt),
          createdAt: toIsoString(paymentLink.createdAt),
          updatedAt: toIsoString(paymentLink.updatedAt),
        },
        ...(linkTransaction ? {
          paymentLinkCustomerData: {
            customerEmail: linkTransaction.customerEmail,
            ...(linkTransaction.customerData ?? {}),
          },
        } : {}),
      },
    }
  },
}

export const interceptors: ApiInterceptor[] = [sessionsInterceptor, transactionDetailInterceptor]
