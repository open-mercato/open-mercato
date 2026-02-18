import type {
  MessageActionsProps,
  MessageContentProps,
  ObjectPreviewData,
} from '@open-mercato/shared/modules/messages/types'

export type MessageDetailRecipient = {
  userId: string
  type: 'to' | 'cc' | 'bcc'
  status: string
  readAt?: string | null
}

export type MessageDetailObject = {
  id: string
  entityModule: string
  entityType: string
  entityId: string
  actionRequired: boolean
  actionType?: string | null
  actionLabel?: string | null
  snapshot?: Record<string, unknown> | null
  preview?: ObjectPreviewData | null
}

export type MessageAttachment = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  url: string
}

export type MessageAction = {
  id: string
  label: string
  labelKey?: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  icon?: string
  commandId?: string
  href?: string
  isTerminal?: boolean
  confirmRequired?: boolean
  confirmMessage?: string
}

export type MessageDetail = {
  id: string
  type: string
  visibility?: 'public' | 'internal' | null
  sourceEntityType?: string | null
  sourceEntityId?: string | null
  externalEmail?: string | null
  externalName?: string | null
  typeDefinition: {
    labelKey: string
    icon: string
    color?: string | null
    allowReply: boolean
    allowForward: boolean
    ui?: {
      listItemComponent?: string | null
      contentComponent?: string | null
      actionsComponent?: string | null
    } | null
  }
  threadId?: string | null
  parentMessageId?: string | null
  senderUserId: string
  senderName?: string | null
  senderEmail?: string | null
  subject: string
  body: string
  bodyFormat: 'text' | 'markdown'
  priority: string
  sentAt?: string | null
  actionData?: {
    actions: MessageAction[]
    primaryActionId?: string
    expiresAt?: string
  } | null
  actionTaken?: string | null
  actionTakenAt?: string | null
  actionTakenByUserId?: string | null
  recipients: MessageDetailRecipient[]
  objects: MessageDetailObject[]
  thread: Array<{
    id: string
    senderUserId: string
    senderName?: string | null
    senderEmail?: string | null
    body: string
    sentAt?: string | null
    objects?: MessageDetailObject[]
  }>
  isRead: boolean
}

export type ActionResult = {
  ok?: boolean
  actionId?: string
  result?: Record<string, unknown>
}

export type PendingActionConfirmation = {
  action: MessageAction
  payload?: Record<string, unknown>
}

export type DetailContentProps = MessageContentProps
export type ExecuteActionById = MessageActionsProps['onExecuteAction']
