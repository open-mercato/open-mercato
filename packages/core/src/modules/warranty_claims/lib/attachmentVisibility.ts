export const CUSTOMER_VISIBLE_ATTACHMENT_TAG = 'customer-visible'

export function isCustomerVisibleAttachment(metadataTags: string[] | undefined): boolean {
  return Array.isArray(metadataTags) && metadataTags.includes(CUSTOMER_VISIBLE_ATTACHMENT_TAG)
}
