import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PaymentLinkTemplate } from '@open-mercato/pay-by-links/modules/payment_link_pages/data/entities'
import { emitPaymentLinkPageEvent } from '@open-mercato/pay-by-links/modules/payment_link_pages/events'

export const metadata = {
  path: '/payment_link_pages/templates/[id]/set-default',
  POST: { requireAuth: true, requireFeatures: ['payment_link_pages.templates.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string; auth: { orgId: string; tenantId: string } } }) {
  const { id, auth } = params
  if (!id || !auth) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const template = await findOneWithDecryption(em, PaymentLinkTemplate, {
    id,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  }, undefined, scope)

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const currentDefaults = await findWithDecryption(em, PaymentLinkTemplate, {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    isDefault: true,
    deletedAt: null,
  }, undefined, scope)

  for (const existing of currentDefaults) {
    if (existing.id !== template.id) {
      existing.isDefault = false
    }
  }

  template.isDefault = true
  await em.flush()

  await emitPaymentLinkPageEvent('payment_link_pages.template.updated', {
    templateId: template.id,
    name: template.name,
    organizationId: template.organizationId,
    tenantId: template.tenantId,
  })

  return NextResponse.json({ ok: true, id: template.id })
}

export const openApi = {
  tags: ['Payment Link Templates'],
  summary: 'Set a template as the organization default',
  methods: {
    POST: {
      summary: 'Set default template',
      tags: ['Payment Link Templates'],
      responses: [
        { status: 200, description: 'Template set as default' },
        { status: 404, description: 'Template not found' },
      ],
    },
  },
}

export default POST
