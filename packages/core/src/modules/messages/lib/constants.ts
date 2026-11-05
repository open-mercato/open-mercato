export const MESSAGE_ENTITY_ID = 'messages:message'
export const MESSAGE_ATTACHMENT_ENTITY_ID = MESSAGE_ENTITY_ID
export const MESSAGE_ATTACHMENT_PARTITION = 'messages'

// Resource kind used by the command-level OSS optimistic-lock guard so stale
// draft edits and message actions fail with the structured 409 conflict.
export const MESSAGE_OPTIMISTIC_LOCK_RESOURCE_KIND = 'messages.message'

// Sender of messages composed on behalf of the platform rather than a person —
// a communication channel's inbound ingest, inbox_ops, warranty_claims. No
// `users` row exists for it, so it can never be a reply or notification
// recipient (#6391).
export const SYSTEM_SENDER_USER_ID = '00000000-0000-0000-0000-000000000000'
