import type * as React from 'react'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { MessagePriority } from './message-priority'

export type MessageTypeItem = {
  type: string
  module: string
  labelKey: string
  icon: string
  color?: string | null
  isCreateableByUser?: boolean | null
  allowReply: boolean
  allowForward: boolean
  actionsExpireAfterHours?: number | null
}

export type UserListItem = {
  id: string
  email?: string | null
  name?: string | null
}

export type AttachmentListResponse = {
  items?: Array<{ id?: string }>
}

export type MessageComposerVariant = 'compose' | 'reply' | 'forward'

/**
 * One entry of the composer's "Send from" list, in provider-agnostic terms.
 *
 * The composer never learns what backs an option — the host module supplies the
 * list and the API route decides how a selected id is routed. An empty list
 * hides the control entirely, which is what a host without any configured
 * sender renders.
 */
export type MessageSenderOption = {
  id: string
  label: string
  description?: string | null
  /**
   * The option to reach for first when the user opts out of the platform
   * sender. It orders the list; it does not preselect, because the platform
   * sender stays the default.
   */
  isDefault?: boolean
}

export type MessageComposerContextObject = {
  entityModule: string
  entityType: string
  entityId: string
  actionRequired?: boolean
  actionType?: string
  actionLabel?: string
  sourceEntityType?: string | null
  sourceEntityId?: string | null
  previewData?: ObjectPreviewData | null
}

export type MessageComposerRequiredActionOption = {
  id: string
  label: string
}

export type MessageComposerRequiredActionConfig = {
  mode?: 'none' | 'optional' | 'required'
  defaultActionType?: string | null
  options?: MessageComposerRequiredActionOption[]
}

export type MessageComposerProps = {
  variant?: MessageComposerVariant
  messageId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  inline?: boolean
  inlineBackHref?: string | null
  lockedType?: string | null
  contextObject?: MessageComposerContextObject | null
  requiredActionConfig?: MessageComposerRequiredActionConfig | null
  contextPreview?: React.ReactNode
  /**
   * Alternative senders offered next to the default platform sender. Rendered
   * only in the compose variant addressing an external recipient, and only when
   * non-empty.
   */
  senderOptions?: MessageSenderOption[]
  /**
   * Expected `updated_at` of the existing draft being edited. When present, the
   * composer attaches the OSS optimistic-lock header to the draft save/send
   * PATCH so a stale tab cannot silently overwrite a concurrently-changed draft.
   */
  expectedUpdatedAt?: string | null
  defaultValues?: {
    type?: string
    recipients?: string[]
    subject?: string
    body?: string
    bodyFormat?: 'text' | 'markdown'
    priority?: MessagePriority
    visibility?: 'public' | 'internal'
    sourceEntityType?: string | null
    sourceEntityId?: string | null
    externalEmail?: string | null
    externalName?: string | null
    attachmentIds?: string[]
    sendViaEmail?: boolean
    replyAll?: boolean
    includeAttachments?: boolean
  }
  onSuccess?: (result: { id?: string }) => void
  onCancel?: () => void
}
