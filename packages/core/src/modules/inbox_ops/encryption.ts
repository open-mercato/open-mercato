import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// Message body, extracted business data, and correspondent identities all
// count as tenant PII. Columns routed through WHERE/ILIKE lookups or UNIQUE
// indexes (`inbox_settings.inbox_address`, `inbox_emails.message_id`,
// `in_reply_to`, `references`, `*.metadata`) are intentionally left plaintext
// for now — encrypting them requires paired `*_hash` columns plus rewriting
// the inbound-webhook lookups, which is out of scope for this fix.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    // `webhook_secret` is a tenant-scoped signing credential, never used in a
    // WHERE/ILIKE lookup (it is loaded via the settings row, then compared with
    // timingSafeEqual), so it is safe — and required — to encrypt at rest.
    entityId: 'inbox_ops:inbox_settings',
    fields: [
      { field: 'webhook_secret' },
    ],
  },
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
      // Field provenance quotes mail and attachment content (file names, snippets).
      { field: 'source_refs' },
    ],
  },
  {
    // Ledger of inbound email parts: the original file name and the text
    // extracted at upload are mail content. Both are cleared on release.
    entityId: 'inbox_ops:inbox_email_attachment',
    fields: [
      { field: 'file_name' },
      { field: 'extracted_text' },
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
