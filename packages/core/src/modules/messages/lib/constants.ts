export const MESSAGE_ENTITY_ID = 'messages:message'
export const MESSAGE_ATTACHMENT_ENTITY_ID = MESSAGE_ENTITY_ID
export const MESSAGE_ATTACHMENT_PARTITION = 'messages'

// Resource kind used by the command-level OSS optimistic-lock guard so stale
// draft edits and message actions fail with the structured 409 conflict.
export const MESSAGE_OPTIMISTIC_LOCK_RESOURCE_KIND = 'messages.message'
