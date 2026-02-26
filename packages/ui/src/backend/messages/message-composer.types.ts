import type * as React from 'react'
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

export type MessageComposerContextObject = {
  entityModule: string
  entityType: string
  entityId: string
  actionRequired?: boolean
  actionType?: string
  actionLabel?: string
  sourceEntityType?: string | null
  sourceEntityId?: string | null
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
