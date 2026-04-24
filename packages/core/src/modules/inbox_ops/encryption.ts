import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// Message body, extracted business data, and correspondent identities all
// count as tenant PII. Columns routed through WHERE/ILIKE lookups or UNIQUE
// indexes (`inbox_settings.inbox_address`, `inbox_emails.message_id`,
// `in_reply_to`, `references`, `*.metadata`) are intentionally left plaintext
// for now — encrypting them requires paired `*_hash` columns plus rewriting
// the inbound-webhook lookups, which is out of scope for this fix.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'inbox_ops:inbox_email',
    fields: [
      { field: 'subject' },
      { field: 'raw_text' },
      { field: 'raw_html' },
      { field: 'cleaned_text' },
      { field: 'thread_messages' },
      { field: 'forwarded_by_address' },
      { field: 'forwarded_by_name' },
      { field: 'to_address' },
      { field: 'reply_to' },
      { field: 'processing_error' },
    ],
  },
  {
    entityId: 'inbox_ops:inbox_proposal',
    fields: [
      { field: 'summary' },
      { field: 'participants' },
      { field: 'translations' },
    ],
  },
  {
    entityId: 'inbox_ops:inbox_proposal_action',
    fields: [
      { field: 'description' },
      { field: 'payload' },
      { field: 'execution_error' },
    ],
  },
  {
    entityId: 'inbox_ops:inbox_discrepancy',
    fields: [
      { field: 'description' },
      { field: 'expected_value' },
      { field: 'found_value' },
    ],
  },
]

export default defaultEncryptionMaps
