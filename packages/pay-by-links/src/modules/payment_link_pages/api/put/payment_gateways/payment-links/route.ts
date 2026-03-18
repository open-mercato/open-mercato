import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GatewayPaymentLink } from '@open-mercato/pay-by-links/modules/payment_link_pages/data/entities'
import { paymentGatewaysTag } from '@open-mercato/core/modules/payment_gateways/api/openapi'

export const metadata = {
  path: '/payment_gateways/payment-links',
  PUT: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
}

const updatePaymentLinkSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(160).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
  maxUses: z.number().int().positive().optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).optional().nullable(),
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

  const { id, title, description, status, maxUses, customFields } = parsed.data
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const link = await em.findOne(GatewayPaymentLink, {
    id,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })

  if (!link) {
    return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
  }

  if (title !== undefined) link.title = title
  if (description !== undefined) link.description = description
  if (status !== undefined) link.status = status
  if (maxUses !== undefined) link.maxUses = maxUses

  if (customFields !== undefined) {
    const existingMeta = link.metadata ?? {}
    link.metadata = { ...existingMeta, customFields }
  }

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
