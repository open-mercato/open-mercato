import type { ComponentType } from 'react'

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

export type MessageActionData = {
  actions: MessageAction[]
  primaryActionId?: string
  expiresAt?: string
}

export type MessageListItemProps = {
  message: {
    id: string
    type: string
    typeLabel?: string
    subject: string
    body: string
    bodyFormat: 'text' | 'markdown'
    priority: 'low' | 'normal' | 'high' | 'urgent'
    sentAt: Date | null
    senderName?: string
    senderAvatar?: string
    hasObjects: boolean
    objectCount?: number
    hasAttachments: boolean
    attachmentCount?: number
    recipientCount?: number
    hasActions: boolean
    actionTaken?: string | null
    unread: boolean
  }
  onClick: () => void
}

export type MessageContentProps = {
  message: {
    id: string
    type: string
    subject: string
    body: string
    bodyFormat: 'text' | 'markdown'
    priority: 'low' | 'normal' | 'high' | 'urgent'
    sentAt: Date | null
    senderName?: string
    senderAvatar?: string
    senderUserId: string
    actionData?: MessageActionData | null
    actionTaken?: string | null
    actionTakenAt?: Date | null
    actionTakenByName?: string
  }
  objects: Array<{
    id: string
    entityModule: string
    entityType: string
    entityId: string
    actionRequired: boolean
    snapshot?: Record<string, unknown>
  }>
  attachments: Array<{
    id: string
    fileName: string
    fileSize: number
    mimeType: string
    url: string
  }>
}

export type MessageActionsProps = {
  message: {
    id: string
    type: string
    actionData?: MessageActionData | null
    actionTaken?: string | null
  }
  onExecuteAction: (actionId: string, payload?: Record<string, unknown>) => Promise<void>
  isExecuting: boolean
  executingActionId?: string | null
}

export type MessageTypeDefinition = {
  type: string
  module: string
  labelKey: string
  icon: string
  color?: string
  isCreateableByUser: boolean
  ui?: {
    listItemComponent?: string
    contentComponent?: string
    actionsComponent?: string
  }
  ListItemComponent?: ComponentType<MessageListItemProps>
  ContentComponent?: ComponentType<MessageContentProps>
  ActionsComponent?: ComponentType<MessageActionsProps>
  defaultActions?: MessageAction[]
  allowReply?: boolean
  allowForward?: boolean
  actionsExpireAfterHours?: number
}

export type MessageObjectAction = {
  id: string
  labelKey: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  icon?: string
  commandId?: string
  href?: string
  isTerminal?: boolean
  confirmRequired?: boolean
  confirmMessage?: string
}

export type ObjectPreviewProps = {
  entityId: string
  entityModule: string
  entityType: string
  snapshot?: Record<string, unknown>
  previewData?: ObjectPreviewData
  actionRequired?: boolean
  actionType?: string
  actionLabel?: string
}

export type ObjectDetailProps = ObjectPreviewProps & {
  onAction: (actionId: string, payload?: Record<string, unknown>) => Promise<void>
  actions: MessageObjectAction[]
  actionTaken?: string | null
  actionTakenAt?: Date | null
  actionTakenByUserId?: string | null
}

export type ObjectPreviewData = {
  title: string
  subtitle?: string
  status?: string
  statusColor?: string
  metadata?: Record<string, string>
}

export type ObjectPickerRecord = {
  id: string
  label: string
  subtitle?: string
  snapshot?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type ObjectPickerQueryState = {
  search?: string
  page?: number
  pageSize?: number
  filters?: Record<string, unknown>
}

export type ObjectPickerResult = {
  items: ObjectPickerRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type ObjectPickerTypeMeta = {
  module: string
  entityType: string
  labelKey: string
  icon?: string
}

export type ObjectPickerSelectedObject = {
  entityModule: string
  entityType: string
  entityId: string
}

export type ObjectPickerComponentProps = {
  messageType: string
  objectType: ObjectPickerTypeMeta
  selectedObjects: ObjectPickerSelectedObject[]
  selectedRecord: ObjectPickerRecord | null
  onSelectRecord: (record: ObjectPickerRecord | null) => void
  queryState: ObjectPickerQueryState
  onQueryStateChange: (queryState: ObjectPickerQueryState) => void
}

export type ObjectPickerComponent = ComponentType<ObjectPickerComponentProps>
export type ObjectPickerProps = ObjectPickerComponentProps

export type LoadContext = {
  tenantId: string
  organizationId?: string | null
}

export type MessageObjectTypeDefinition = {
  module: string
  entityType: string
  labelKey: string
  icon: string
  messageTypes?: string[]
  entityId?: string
  optionLabelField?: string
  optionSubtitleField?: string
  PreviewComponent?: ComponentType<ObjectPreviewProps>
  DetailComponent?: ComponentType<ObjectDetailProps>
  ObjectPickerComponent?: ObjectPickerComponent
  actions: MessageObjectAction[]
  loadPreview?: (entityId: string, ctx: LoadContext) => Promise<ObjectPreviewData>
}
