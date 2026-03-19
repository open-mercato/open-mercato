import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { PaymentLink } from '@open-mercato/pay-by-links/modules/payment_link_pages/data/entities'
import { paymentGatewaysTag } from '@open-mercato/core/modules/payment_gateways/api/openapi'
import { hashPaymentLinkPassword } from '@open-mercato/pay-by-links/modules/payment_link_pages/lib/payment-links'

export const metadata = {
  path: '/payment_gateways/payment-links',
  PUT: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
}

const brandingSchema = z.object({
  logoUrl: z.string().max(2000).nullable().optional(),
  brandName: z.string().max(200).nullable().optional(),
  securitySubtitle: z.string().max(200).nullable().optional(),
  accentColor: z.string().max(20).nullable().optional(),
  customCss: z.string().max(10000).nullable().optional(),
}).optional()

const customerCaptureSchema = z.object({
  enabled: z.boolean().optional(),
  customerHandlingMode: z.enum(['no_customer', 'create_new']).optional(),
  companyRequired: z.boolean().optional(),
  termsRequired: z.boolean().optional(),
  termsMarkdown: z.string().max(20000).nullable().optional(),
  fields: z.record(z.string(), z.object({
    visible: z.boolean().optional(),
    required: z.boolean().optional(),
    format: z.string().optional(),
  })).optional(),
}).optional()

const notificationsSchema = z.object({
  onFormSubmitted: z.object({
    enabled: z.boolean().optional(),
    emailTemplate: z.string().max(50000).nullable().optional(),
  }).optional(),
  onPaymentCompleted: z.object({
    enabled: z.boolean().optional(),
    emailTemplate: z.string().max(50000).nullable().optional(),
  }).optional(),
}).optional()

const updatePaymentLinkSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(160).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
  maxUses: z.number().int().positive().optional().nullable(),
  password: z.string().min(4).max(128).optional().nullable(),
  branding: brandingSchema,
  defaultTitle: z.string().max(160).nullable().optional(),
  defaultDescription: z.string().max(500).nullable().optional(),
  customerCapture: customerCaptureSchema,
  notifications: notificationsSchema,
  amountType: z.enum(['fixed', 'customer_input', 'predefined']).optional(),
  amountOptions: z.array(z.object({
    amount: z.number().positive(),
    label: z.string().min(1).max(200),
  })).max(50).nullable().optional(),
  minAmount: z.number().min(0).nullable().optional(),
  maxAmount: z.number().min(0).nullable().optional(),
  customerFieldsetCode: z.string().max(100).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updatePaymentLinkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const {
    id, title, description, status, maxUses, password,
    branding, defaultTitle, defaultDescription,
    customerCapture, notifications, amountType, amountOptions, minAmount, maxAmount,
    customerFieldsetCode, customFields, metadata: userMetadata,
  } = parsed.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const link = await em.findOne(PaymentLink, {
    id,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })

  if (!link) {
    return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
  }

  // Update entity columns
  if (title !== undefined) link.title = title
  if (description !== undefined) link.description = description
  if (status !== undefined) link.status = status
  if (maxUses !== undefined) link.maxUses = maxUses

  // Hash and update password
  if (password) {
    link.passwordHash = await hashPaymentLinkPassword(password)
  }

  // Update metadata JSONB
  const existingMeta = (link.metadata ?? {}) as Record<string, unknown>
  const pageMetadata = ((existingMeta.pageMetadata ?? {}) as Record<string, unknown>)

  if (branding !== undefined) {
    pageMetadata.branding = branding
  }
  if (defaultTitle !== undefined) {
    pageMetadata.defaultTitle = defaultTitle
  }
  if (defaultDescription !== undefined) {
    pageMetadata.defaultDescription = defaultDescription
  }

  if (Object.keys(pageMetadata).length > 0) {
    existingMeta.pageMetadata = pageMetadata
  }

  if (customerCapture !== undefined) {
    const existingCapture = ((existingMeta.customerCapture ?? {}) as Record<string, unknown>)
    existingMeta.customerCapture = { ...existingCapture, ...customerCapture }
  }

  if (amountType !== undefined) {
    existingMeta.amountType = amountType
  }
  if (amountOptions !== undefined) {
    existingMeta.amountOptions = amountOptions
  }
  if (minAmount !== undefined) {
    existingMeta.minAmount = minAmount
  }
  if (maxAmount !== undefined) {
    existingMeta.maxAmount = maxAmount
  }
  if (customerFieldsetCode !== undefined) {
    existingMeta.customerFieldsetCode = customerFieldsetCode
  }
  if (customFields !== undefined) {
    existingMeta.customFields = customFields
  }
  if (notifications !== undefined) {
    existingMeta.notifications = notifications
  }

  // Merge user metadata (non-reserved keys only)
  if (userMetadata) {
    const reservedKeys = new Set([
      'amount', 'amountType', 'amountOptions', 'currencyCode',
      'pageMetadata', 'customFields', 'customFieldsetCode',
      'customerFieldsetCode', 'customerFieldValues',
      'customerCapture', 'sessionParams', 'notifications',
    ])
    for (const [key, value] of Object.entries(userMetadata)) {
      if (!reservedKeys.has(key)) {
        existingMeta[key] = value
      }
    }
  }

  link.metadata = existingMeta

  await em.flush()

  return NextResponse.json({ ok: true, id: link.id })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Update a payment link',
  methods: {
    PUT: {
      summary: 'Update a payment link',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment link updated' },
        { status: 404, description: 'Not found' },
      ],
    },
  },
}

export default PUT
