import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'customers:customer_address',
    fields: [
      { field: 'name' },
      { field: 'company_name' },
      { field: 'address_line1' },
      { field: 'address_line2' },
      { field: 'city' },
      { field: 'region' },
      { field: 'postal_code' },
      { field: 'country' },
      { field: 'building_number' },
      { field: 'flat_number' },
    ],
  },
  {
    entityId: 'customers:customer_entity',
    fields: [
      { field: 'display_name' },
      { field: 'primary_email' },
      { field: 'primary_phone' },
      { field: 'next_interaction_name' },
      { field: 'description' },
    ],
  },
  {
    entityId: 'customers:customer_deal',
    fields: [
      { field: 'title' },
      { field: 'description' },
    ],
  },
  {
    entityId: 'customers:customer_activity',
    fields: [
      { field: 'subject' },
      { field: 'body' },
    ],
  },
  {
    // Interactions carry call/meeting notes and, for interactionType='email',
    // the email subject (title) and body — sensitive PII. Encrypt at rest like
    // the sibling customer_activity. Read paths use findWithDecryption; the
    // interactions list route decrypts title/body for the returned page.
    entityId: 'customers:customer_interaction',
    fields: [
      { field: 'title' },
      { field: 'body' },
    ],
  },
  {
    entityId: 'customers:customer_comment',
    fields: [{ field: 'body' }],
  },
  {
    entityId: 'customers:customer_person_profile',
    fields: [
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'preferred_name' },
      { field: 'job_title' },
      { field: 'department' },
      { field: 'seniority' },
      { field: 'timezone' },
      { field: 'linked_in_url' },
      { field: 'twitter_url' },
    ],
  },
  {
    entityId: 'customers:customer_company_profile',
    fields: [
      { field: 'legal_name' },
      { field: 'brand_name' },
      { field: 'domain' },
      { field: 'website_url' },
      { field: 'industry' },
    ],
  },
  {
    entityId: 'customers:customer_lead',
    fields: [
      { field: 'title' },
      { field: 'description' },
      { field: 'source' },
      { field: 'company_name' },
      { field: 'company_vat_id' },
      { field: 'contact_first_name' },
      { field: 'contact_last_name' },
      { field: 'contact_phone' },
      { field: 'contact_email' },
    ],
  },
]

export default defaultEncryptionMaps
