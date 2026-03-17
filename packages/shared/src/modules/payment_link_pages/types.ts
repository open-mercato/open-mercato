import { ComponentReplacementHandles } from '../widgets/component-registry'

export const PAYMENT_LINK_PAGE_ROUTE = '/pay/[token]'
export const PAYMENT_LINK_PAGE_COMPONENT_HANDLE = ComponentReplacementHandles.page(PAYMENT_LINK_PAGE_ROUTE)
export const PAYMENT_LINK_PAGE_ENRICHER_ENTITY = 'payment_link_pages.payment_link_page'
export const PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID = 'payment_link_pages:payment_link_page'

export function buildPaymentLinkPageInjectionSpotId(
  section: 'before' | 'hero' | 'summary' | 'checkout' | 'after',
): string {
  return `payment-link-pages.pay:${section}`
}

export function buildPaymentLinkPageSectionHandle(
  section: 'brand' | 'summary' | 'checkout',
): string {
  return ComponentReplacementHandles.section('payment_link_pages', section)
}
