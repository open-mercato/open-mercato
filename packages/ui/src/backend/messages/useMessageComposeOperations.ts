import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  MessageComposerContextObject,
  MessageComposerProps,
  MessageTypeItem,
} from './message-composer.types'
import type { MessagePriority } from './message-priority'

type Translator = ReturnType<typeof useT>

type MessageRecipient = {
  userId: string
  type: 'to'
}

type SubmitRequest = {
  endpoint: string
  payload: Record<string, unknown>
}

type BaseOperation = {
  validate: () => string | null
  buildRequest: (input: { attachmentIds: string[] }) => SubmitRequest
  successMessage: string
  requiresAttachmentRefresh: boolean
}

type ComposeOperationParams = {
  t: Translator
  messageType: string
  createableMessageTypes: MessageTypeItem[]
  priority: MessagePriority
  visibility: 'public' | 'internal'
  externalEmail: string
  recipientIds: string[]
  subject: string
  body: string
  bodyFormat: 'text' | 'markdown'
  sendViaEmail: boolean
  contextObject: MessageComposerContextObject | null
  defaultValues: MessageComposerProps['defaultValues']
  contextActionOptions: Array<{ id: string; label: string }>
  normalizedRequiredActionMode: 'none' | 'optional' | 'required'
  shouldShowContextActions: boolean
  contextActionRequired: boolean
  contextActionType: string
}

type ReplyOperationParams = {
  t: Translator
  messageId?: string
  body: string
  bodyFormat: 'text' | 'markdown'
  replyAll: boolean
  recipientIds: string[]
  sendViaEmail: boolean
}

type ForwardOperationParams = {
  t: Translator
  messageId?: string
  recipientIds: string[]
  body: string
  includeAttachments: boolean
  sendViaEmail: boolean
}

type DraftOperationParams = Omit<ComposeOperationParams, 'createableMessageTypes'>

function isValidEmailAddress(value: string): boolean {
  const email = value.trim()
  if (!email || email.length > 254) return false

  const atIndex = email.indexOf('@')
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@') || atIndex === email.length - 1) return false

  for (const char of email) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return false
  }

  const localPart = email.slice(0, atIndex)
  const domainPart = email.slice(atIndex + 1)
  if (!localPart || !domainPart || localPart.length > 64) return false
  if (domainPart.length > 253 || !domainPart.includes('.')) return false
  if (domainPart.startsWith('.') || domainPart.endsWith('.') || domainPart.includes('..')) return false

  const domainLabels = domainPart.split('.')
  for (const label of domainLabels) {
    if (!label) return false
    if (label.startsWith('-') || label.endsWith('-')) return false
  }

  return true
}

function mapRecipients(recipientIds: string[]): MessageRecipient[] {
  return recipientIds.map((userId) => ({ userId, type: 'to' }))
}

function buildComposePayload(
  params: ComposeOperationParams | DraftOperationParams,
  input: { attachmentIds: string[]; isDraft: boolean },
): Record<string, unknown> {
  const publicMessage = params.visibility === 'public'
  const sourceEntityType = params.contextObject?.sourceEntityType ?? params.defaultValues?.sourceEntityType
  const sourceEntityId = params.contextObject?.sourceEntityId ?? params.defaultValues?.sourceEntityId
  const selectedContextActionOption = params.contextActionOptions.find((option) => option.id === params.contextActionType)
  const resolvedContextActionRequired = params.shouldShowContextActions
    ? (params.normalizedRequiredActionMode === 'required' ? true : params.contextActionRequired)
    : (params.contextObject?.actionRequired ?? false)
  const resolvedContextActionType = resolvedContextActionRequired
    ? (params.shouldShowContextActions ? params.contextActionType : params.contextObject?.actionType)
    : undefined
  const resolvedContextActionLabel = resolvedContextActionRequired
    ? (params.shouldShowContextActions ? selectedContextActionOption?.label : params.contextObject?.actionLabel)
    : undefined
  const contextObjects = params.contextObject
    ? [{
      entityModule: params.contextObject.entityModule,
      entityType: params.contextObject.entityType,
      entityId: params.contextObject.entityId,
      actionRequired: resolvedContextActionRequired,
      actionType: resolvedContextActionType,
      actionLabel: resolvedContextActionLabel,
    }]
    : undefined

  return {
    type: params.messageType,
    priority: params.priority,
    visibility: params.visibility,
    externalEmail: publicMessage ? params.externalEmail.trim() : undefined,
    externalName: undefined,
    recipients: publicMessage ? [] : mapRecipients(params.recipientIds),
    subject: params.subject.trim(),
    body: params.body,
    bodyFormat: params.bodyFormat,
    sourceEntityType: sourceEntityType ?? undefined,
    sourceEntityId: sourceEntityId ?? undefined,
    objects: contextObjects,
    attachmentIds: input.attachmentIds.length > 0 ? input.attachmentIds : undefined,
    sendViaEmail: publicMessage ? true : params.sendViaEmail,
    isDraft: input.isDraft,
  }
}

export function useComposeSendOperation(params: ComposeOperationParams): BaseOperation {
  return React.useMemo(() => ({
    validate: () => {
      if (params.visibility !== 'public' && params.recipientIds.length === 0) {
        return params.t('messages.errors.noRecipients', 'Please add at least one recipient.')
      }
      if (params.visibility === 'public' && !isValidEmailAddress(params.externalEmail.trim())) {
        return params.t('messages.errors.noExternalEmail', 'Please enter a valid external email.')
      }
      if (!params.subject.trim()) {
        return params.t('messages.errors.noSubject', 'Please enter a subject.')
      }
      if (!params.body.trim()) {
        return params.t('messages.errors.noBody', 'Please enter a message.')
      }
      if (!params.createableMessageTypes.some((item) => item.type === params.messageType)) {
        return params.t('messages.errors.sendFailed', 'Failed to send message.')
      }
      if (
        params.shouldShowContextActions
        && params.normalizedRequiredActionMode === 'required'
        && !params.contextActionType
      ) {
        return params.t('messages.composer.objectPicker.errors.actionRequired', 'Select an action.')
      }
      if (
        params.shouldShowContextActions
        && params.normalizedRequiredActionMode === 'optional'
        && params.contextActionRequired
        && !params.contextActionType
      ) {
        return params.t('messages.composer.objectPicker.errors.actionRequired', 'Select an action.')
      }
      return null
    },
    buildRequest: ({ attachmentIds }) => ({
      endpoint: '/api/messages',
      payload: buildComposePayload(params, { attachmentIds, isDraft: false }),
    }),
    successMessage: params.t('messages.flash.sentSuccess', 'Message sent.'),
    requiresAttachmentRefresh: true,
  }), [params])
}

export function useComposeDraftOperation(params: DraftOperationParams): BaseOperation {
  return React.useMemo(() => ({
    validate: () => null,
    buildRequest: ({ attachmentIds }) => ({
      endpoint: '/api/messages',
      payload: buildComposePayload(params, { attachmentIds, isDraft: true }),
    }),
    successMessage: params.t('messages.flash.draftSaved', 'Draft saved.'),
    requiresAttachmentRefresh: true,
  }), [params])
}

export function useReplySubmitOperation(params: ReplyOperationParams): BaseOperation {
  return React.useMemo(() => ({
    validate: () => {
      if (!params.body.trim()) {
        return params.t('messages.errors.noBody', 'Please enter a message.')
      }
      if (!params.messageId) {
        return params.t('messages.errors.invalidContext', 'Message context is missing.')
      }
      return null
    },
    buildRequest: ({ attachmentIds }) => ({
      endpoint: `/api/messages/${encodeURIComponent(params.messageId ?? '')}/reply`,
      payload: {
        body: params.body,
        bodyFormat: params.bodyFormat,
        replyAll: params.replyAll,
        recipients: params.recipientIds.length > 0 ? mapRecipients(params.recipientIds) : undefined,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        sendViaEmail: params.sendViaEmail,
      },
    }),
    successMessage: params.t('messages.flash.replySuccess', 'Reply sent.'),
    requiresAttachmentRefresh: true,
  }), [params])
}

export function useForwardSubmitOperation(params: ForwardOperationParams): BaseOperation {
  return React.useMemo(() => ({
    validate: () => {
      if (params.recipientIds.length === 0) {
        return params.t('messages.errors.noRecipients', 'Please add at least one recipient.')
      }
      if (!params.messageId) {
        return params.t('messages.errors.invalidContext', 'Message context is missing.')
      }
      if (!params.body.trim()) {
        return params.t('messages.errors.noBody', 'Please enter a message.')
      }
      return null
    },
    buildRequest: () => ({
      endpoint: `/api/messages/${encodeURIComponent(params.messageId ?? '')}/forward`,
      payload: {
        recipients: mapRecipients(params.recipientIds),
        body: params.body,
        includeAttachments: params.includeAttachments,
        sendViaEmail: params.sendViaEmail,
      },
    }),
    successMessage: params.t('messages.flash.forwardSuccess', 'Message forwarded.'),
    requiresAttachmentRefresh: false,
  }), [params])
}

export type MessageComposeSubmitOperation = BaseOperation
