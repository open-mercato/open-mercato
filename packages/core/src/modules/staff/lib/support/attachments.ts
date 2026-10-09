export const SUPPORT_TICKET_ATTACHMENT_ENTITY_ID = 'staff:staff_time_task'
export const CUSTOMER_VISIBLE_ATTACHMENT_TAG = 'customer-visible'
export const CUSTOMER_UPLOAD_TAG_PREFIX = 'customer-upload:'

export function customerUploadTag(customerUserId: string): string {
  return `${CUSTOMER_UPLOAD_TAG_PREFIX}${customerUserId}`
}

export function isCustomerVisibleAttachmentTags(tags: readonly string[] | null | undefined): boolean {
  return Array.isArray(tags) && tags.includes(CUSTOMER_VISIBLE_ATTACHMENT_TAG)
}
