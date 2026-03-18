import { registerPayByLinksRuntime, registerPayByLinksTemplateResolver } from '@open-mercato/shared/modules/payment_link_pages/runtime'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PaymentLinkTemplate } from './data/entities'

registerPayByLinksRuntime()

registerPayByLinksTemplateResolver(async (em, templateId, organizationId, tenantId) => {
  const template = await findOneWithDecryption(
    em as EntityManager,
    PaymentLinkTemplate,
    { id: templateId, organizationId, tenantId, deletedAt: null },
    undefined,
    { organizationId, tenantId },
  )
  if (!template) return null
  return {
    branding: template.branding,
    metadata: template.metadata,
    customFields: template.customFields,
    customFieldsetCode: template.customFieldsetCode,
    defaultTitle: template.defaultTitle,
    defaultDescription: template.defaultDescription,
    customerCapture: template.customerCapture,
    amountType: template.amountType,
    amountOptions: template.amountOptions,
  }
})

export const metadata = {
  id: 'payment_link_pages',
  title: 'Payment Link Pages',
  description: 'Public pay-by-link page host with UMES-friendly customization, events, and enrichers.',
  requires: ['payment_gateways', 'customers', 'entities'],
}

export default metadata
