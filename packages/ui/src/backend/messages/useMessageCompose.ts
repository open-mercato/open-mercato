import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '../FlashMessages'
import { apiCall } from '../utils/apiCall'
import type {
  AttachmentListResponse,
  MessageComposerProps,
  MessageTypeItem,
  UserListItem,
} from './message-composer.types'
import type { MessagePriority } from './message-priority'
import type { TagsInputOption } from '../inputs/TagsInput'
import {
  useComposeDraftOperation,
  useComposeSendOperation,
  useForwardSubmitOperation,
  useReplySubmitOperation,
} from './useMessageComposeOperations'

function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? toErrorMessage(record.details)
      ?? null
    )
  }
  return null
}

function createTemporaryAttachmentRecordId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `messages-composer:${randomPart}`
}

export type UseMessageComposeParams = MessageComposerProps

export type UseMessageComposeResult = {
  t: ReturnType<typeof useT>
  variant: NonNullable<MessageComposerProps['variant']>
  messageId?: string
  open?: boolean
  inline: boolean
  contextPreview: React.ReactNode
  isOpen: boolean
  messageTypes: MessageTypeItem[]
  createableMessageTypes: MessageTypeItem[]
  normalizedRequiredActionMode: 'none' | 'optional' | 'required'
  contextActionOptions: Array<{ id: string; label: string }>
  shouldShowContextActions: boolean
  isComposePublicVisibility: boolean
  attachmentEntityId: string
  attachmentRecordId: string
  recipientIds: string[]
  setRecipientIds: React.Dispatch<React.SetStateAction<string[]>>
  messageType: string
  setMessageType: React.Dispatch<React.SetStateAction<string>>
  subject: string
  setSubject: React.Dispatch<React.SetStateAction<string>>
  body: string
  setBody: React.Dispatch<React.SetStateAction<string>>
  bodyFormat: 'text' | 'markdown'
  setBodyFormat: React.Dispatch<React.SetStateAction<'text' | 'markdown'>>
  priority: MessagePriority
  setPriority: React.Dispatch<React.SetStateAction<MessagePriority>>
  visibility: 'public' | 'internal'
  setVisibility: React.Dispatch<React.SetStateAction<'public' | 'internal'>>
  externalEmail: string
  setExternalEmail: React.Dispatch<React.SetStateAction<string>>
  sendViaEmail: boolean
  setSendViaEmail: React.Dispatch<React.SetStateAction<boolean>>
  contextActionRequired: boolean
  setContextActionRequired: React.Dispatch<React.SetStateAction<boolean>>
  contextActionType: string
  setContextActionType: React.Dispatch<React.SetStateAction<string>>
  replyAll: boolean
  setReplyAll: React.Dispatch<React.SetStateAction<boolean>>
  includeAttachments: boolean
  setIncludeAttachments: React.Dispatch<React.SetStateAction<boolean>>
  submitting: boolean
  submitMode: 'send' | 'draft'
  submitError: string | null
  composerTitle: string
  submitLabel: string
  selectedRecipientOptions: TagsInputOption[]
  resolveRecipientLabel: (id: string) => string
  loadRecipientSuggestions: (query?: string) => Promise<TagsInputOption[]>
  loadAttachmentIds: () => Promise<string[]>
  handleSaveDraft: () => void
  handleBack: () => void
  handleSubmit: ({ saveAsDraft }?: { saveAsDraft?: boolean }) => Promise<boolean>
  handleDialogOpenChange: (nextOpen: boolean) => void
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

type ForwardPreviewResponse = {
  subject?: string
  body?: string
}

export function useMessageCompose({
  variant: variantProp = 'compose',
  messageId,
  open,
  onOpenChange,
  inline = false,
  lockedType = null,
  contextObject = null,
  requiredActionConfig = null,
  contextPreview = null,
  defaultValues,
  onSuccess,
  onCancel,
}: UseMessageComposeParams): UseMessageComposeResult {
  const t = useT()
  const variant = variantProp
  const isOpen = inline ? true : Boolean(open)

  const [recipientIds, setRecipientIds] = React.useState<string[]>([])
  const [recipientMap, setRecipientMap] = React.useState<Record<string, TagsInputOption>>({})
  const [messageType, setMessageType] = React.useState(lockedType ?? 'default')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [bodyFormat, setBodyFormat] = React.useState<'text' | 'markdown'>('text')
  const [priority, setPriority] = React.useState<MessagePriority>('normal')
  const [visibility, setVisibility] = React.useState<'public' | 'internal'>('internal')
  const [externalEmail, setExternalEmail] = React.useState('')
  const [attachmentIds, setAttachmentIds] = React.useState<string[]>([])
  const [sendViaEmail, setSendViaEmail] = React.useState(false)
  const [contextActionRequired, setContextActionRequired] = React.useState(false)
  const [contextActionType, setContextActionType] = React.useState('')
  const [replyAll, setReplyAll] = React.useState(false)
  const [includeAttachments, setIncludeAttachments] = React.useState(true)
  const [temporaryAttachmentRecordId, setTemporaryAttachmentRecordId] = React.useState<string>(() =>
    createTemporaryAttachmentRecordId(),
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [submitMode, setSubmitMode] = React.useState<'send' | 'draft'>('send')
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const messageTypesQuery = useQuery({
    queryKey: ['messages', 'types'],
    enabled: variant === 'compose' && isOpen,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const call = await apiCall<{ items?: MessageTypeItem[] }>('/api/messages/types')
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadTypesFailed', 'Failed to load message types.'),
        )
      }
      return Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    },
  })

  const messageTypes = React.useMemo(
    () => messageTypesQuery.data ?? [],
    [messageTypesQuery.data],
  )
  const createableMessageTypes = React.useMemo(
    () => messageTypes.filter((item) => item.isCreateableByUser !== false),
    [messageTypes],
  )
  const normalizedRequiredActionMode = requiredActionConfig?.mode ?? 'none'
  const contextActionOptions = React.useMemo(
    () => (requiredActionConfig?.options ?? []).filter((option) => option.id.trim().length > 0),
    [requiredActionConfig?.options],
  )
  const shouldShowContextActions = (
    variant === 'compose'
    && Boolean(contextObject)
    && normalizedRequiredActionMode !== 'none'
    && contextActionOptions.length > 0
  )

  const isComposePublicVisibility = variant === 'compose' && visibility === 'public'

  const attachmentEntityId = variant === 'compose' && messageId ? 'messages:message' : 'attachments:library'
  const attachmentRecordId = variant === 'compose' && messageId ? messageId : temporaryAttachmentRecordId

  const loadAttachmentIds = React.useCallback(async (): Promise<string[]> => {
    const params = new URLSearchParams()
    params.set('entityId', attachmentEntityId)
    params.set('recordId', attachmentRecordId)

    const call = await apiCall<AttachmentListResponse>(`/api/attachments?${params.toString()}`)
    if (!call.ok) {
      throw new Error(
        toErrorMessage(call.result)
        ?? t('messages.errors.loadAttachmentOptionsFailed', 'Failed to load attachments.'),
      )
    }

    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const nextIds = items
      .map((item) => (typeof item?.id === 'string' ? item.id : ''))
      .filter((id) => id.length > 0)

    setAttachmentIds(nextIds)
    return nextIds
  }, [attachmentEntityId, attachmentRecordId, t])

  React.useEffect(() => {
    if (!isOpen) return

    const nextRecipients = defaultValues?.recipients?.filter((value) => typeof value === 'string' && value.trim().length > 0) ?? []
    const dedupedRecipients = Array.from(new Set(nextRecipients))

    setRecipientIds(dedupedRecipients)
    setMessageType(lockedType ?? defaultValues?.type ?? 'default')
    setSubject(defaultValues?.subject ?? '')
    setBody(defaultValues?.body ?? '')
    setBodyFormat(defaultValues?.bodyFormat ?? 'text')
    setPriority(defaultValues?.priority ?? 'normal')
    setVisibility(defaultValues?.visibility ?? 'internal')
    setExternalEmail(defaultValues?.externalEmail ?? '')
    setAttachmentIds(
      Array.isArray(defaultValues?.attachmentIds)
        ? defaultValues.attachmentIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [],
    )
    setSendViaEmail(Boolean(defaultValues?.sendViaEmail))
    if (contextObject) {
      const defaultContextActionType = requiredActionConfig?.defaultActionType?.trim() ?? ''
      const fallbackContextActionType = contextObject.actionType?.trim() ?? ''
      const selectedActionType = defaultContextActionType || fallbackContextActionType
      const selectedActionAllowed = contextActionOptions.some((option) => option.id === selectedActionType)
      const nextActionType = selectedActionAllowed ? selectedActionType : ''
      setContextActionType(nextActionType)
      if (normalizedRequiredActionMode === 'required') {
        setContextActionRequired(true)
      } else if (normalizedRequiredActionMode === 'optional') {
        setContextActionRequired(Boolean(nextActionType) || Boolean(contextObject.actionRequired))
      } else {
        setContextActionRequired(Boolean(contextObject.actionRequired))
      }
    } else {
      setContextActionType('')
      setContextActionRequired(false)
    }
    setReplyAll(Boolean(defaultValues?.replyAll))
    setIncludeAttachments(defaultValues?.includeAttachments !== false)
    setTemporaryAttachmentRecordId(createTemporaryAttachmentRecordId())
    setSubmitError(null)
  }, [
    contextActionOptions,
    contextObject,
    defaultValues,
    isOpen,
    lockedType,
    normalizedRequiredActionMode,
    requiredActionConfig?.defaultActionType,
  ])

  React.useEffect(() => {
    if (!isOpen) return
    if (variant !== 'forward') return
    if (!messageId) return

    let isActive = true

    void (async () => {
      const call = await apiCall<ForwardPreviewResponse>(`/api/messages/${encodeURIComponent(messageId)}/forward-preview`)
      if (!isActive) return

      if (!call.ok) {
        const message = toErrorMessage(call.result)
          ?? t('messages.errors.forwardPreviewFailed', 'Failed to load forward preview.')
        setSubmitError(message)
        flash(message, 'error')
        return
      }

      if (typeof call.result?.subject === 'string') {
        setSubject((previousValue) => (previousValue.trim().length > 0 ? previousValue : call.result?.subject ?? ''))
      }
      if (typeof call.result?.body === 'string') {
        setBody((previousValue) => (previousValue.trim().length > 0 ? previousValue : call.result?.body ?? ''))
      }
      setBodyFormat('text')
    })().catch((error) => {
      if (!isActive) return
      const message = error instanceof Error
        ? error.message
        : t('messages.errors.forwardPreviewFailed', 'Failed to load forward preview.')
      setSubmitError(message)
      flash(message, 'error')
    })

    return () => {
      isActive = false
    }
  }, [isOpen, messageId, t, variant])

  React.useEffect(() => {
    if (!isOpen) return
    if (variant !== 'compose' && variant !== 'reply') return
    void loadAttachmentIds().catch(() => null)
  }, [isOpen, loadAttachmentIds, variant])

  React.useEffect(() => {
    if (variant !== 'compose') return
    if (!createableMessageTypes.length) return

    if (lockedType) {
      if (createableMessageTypes.some((item) => item.type === lockedType)) {
        setMessageType(lockedType)
        return
      }
      const defaultType = createableMessageTypes.find((item) => item.type === 'default')
      setMessageType(defaultType?.type ?? createableMessageTypes[0]?.type ?? 'default')
      return
    }

    if (createableMessageTypes.some((item) => item.type === messageType)) return

    const defaultType = createableMessageTypes.find((item) => item.type === 'default')
    setMessageType(defaultType?.type ?? createableMessageTypes[0]?.type ?? 'default')
  }, [createableMessageTypes, lockedType, messageType, variant])

  React.useEffect(() => {
    if (variant !== 'compose') return
    if (visibility !== 'public') return
    setSendViaEmail(true)
    setRecipientIds([])
  }, [variant, visibility])

  const resolveRecipientLabel = React.useCallback((id: string) => {
    return recipientMap[id]?.label ?? id
  }, [recipientMap])

  const selectedRecipientOptions = React.useMemo(() => {
    return recipientIds.map((id) => recipientMap[id] ?? { value: id, label: id })
  }, [recipientIds, recipientMap])

  const loadRecipientSuggestions = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', '20')
    if (query && query.trim().length) {
      params.set('search', query.trim())
    }

    const call = await apiCall<{ items?: UserListItem[] }>(`/api/auth/users?${params.toString()}`)
    if (!call.ok) {
      return []
    }

    const rawItems = Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    const options: TagsInputOption[] = []
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue
      const id = typeof item.id === 'string' ? item.id : ''
      if (!id) continue

      const email = typeof item.email === 'string' && item.email.trim().length ? item.email.trim() : id
      const name = typeof item.name === 'string' && item.name.trim().length ? item.name.trim() : undefined

      options.push({
        value: id,
        label: email,
        description: name,
      })
    }

    if (options.length) {
      setRecipientMap((prev) => {
        const next = { ...prev }
        for (const option of options) {
          next[option.value] = option
        }
        return next
      })
    }

    return options
  }, [])

  const handleCancel = React.useCallback(() => {
    if (submitting) return
    if (!inline) {
      onOpenChange?.(false)
    }
    onCancel?.()
  }, [inline, onCancel, onOpenChange, submitting])

  const composeSendOperation = useComposeSendOperation({
    t,
    messageType,
    createableMessageTypes,
    priority,
    visibility,
    externalEmail,
    recipientIds,
    subject,
    body,
    bodyFormat,
    sendViaEmail,
    contextObject,
    defaultValues,
    contextActionOptions,
    normalizedRequiredActionMode,
    shouldShowContextActions,
    contextActionRequired,
    contextActionType,
  })

  const composeDraftOperation = useComposeDraftOperation({
    t,
    messageType,
    priority,
    visibility,
    externalEmail,
    recipientIds,
    subject,
    body,
    bodyFormat,
    sendViaEmail,
    contextObject,
    defaultValues,
    contextActionOptions,
    normalizedRequiredActionMode,
    shouldShowContextActions,
    contextActionRequired,
    contextActionType,
  })

  const replyOperation = useReplySubmitOperation({
    t,
    messageId,
    body,
    bodyFormat,
    replyAll,
    recipientIds,
    sendViaEmail,
  })

  const forwardOperation = useForwardSubmitOperation({
    t,
    messageId,
    recipientIds,
    body,
    includeAttachments,
    sendViaEmail,
  })

  const handleSubmit = React.useCallback(async ({ saveAsDraft = false }: { saveAsDraft?: boolean } = {}) => {
    if (submitting) return false

    setSubmitError(null)

    const isComposeDraftSubmit = saveAsDraft && variant === 'compose'
    const operation = isComposeDraftSubmit
      ? composeDraftOperation
      : variant === 'compose'
        ? composeSendOperation
        : variant === 'reply'
          ? replyOperation
          : forwardOperation

    const validationMessage = operation.validate()
    if (validationMessage) {
      setSubmitError(validationMessage)
      flash(validationMessage, 'error')
      return false
    }

    setSubmitMode(isComposeDraftSubmit ? 'draft' : 'send')
    setSubmitting(true)

    try {
      let nextAttachmentIds = attachmentIds
      if (operation.requiresAttachmentRefresh) {
        try {
          nextAttachmentIds = await loadAttachmentIds()
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : t('messages.errors.loadAttachmentOptionsFailed', 'Failed to load attachments.')
          setSubmitError(message)
          flash(message, 'error')
          return false
        }
      }

      const { endpoint, payload } = operation.buildRequest({ attachmentIds: nextAttachmentIds })

      const call = await apiCall<{ id?: string }>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!call.ok) {
        const message = toErrorMessage(call.result) ?? t('messages.errors.sendFailed', 'Failed to send message.')
        setSubmitError(message)
        flash(message, 'error')
        return false
      }

      flash(operation.successMessage, 'success')

      onSuccess?.({ id: call.result?.id })

      if (!inline) {
        onOpenChange?.(false)
      }
      return true
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('messages.errors.sendFailed', 'Failed to send message.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    } finally {
      setSubmitting(false)
      setSubmitMode('send')
    }
  }, [
    attachmentIds,
    composeDraftOperation,
    composeSendOperation,
    forwardOperation,
    inline,
    loadAttachmentIds,
    onOpenChange,
    onSuccess,
    replyOperation,
    submitting,
    t,
    variant,
  ])

  const handleSaveDraft = React.useCallback(() => {
    if (variant !== 'compose') return
    void handleSubmit({ saveAsDraft: true })
  }, [handleSubmit, variant])

  const handleBack = React.useCallback(() => {
    if (submitting) return
    handleCancel()
  }, [handleCancel, submitting])

  const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange?.(true)
      return
    }
    void handleBack()
  }, [handleBack, onOpenChange])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }, [handleCancel, handleSubmit])

  const composerTitle = variant === 'reply'
    ? t('messages.reply', 'Reply')
    : variant === 'forward'
      ? t('messages.forward', 'Forward')
      : t('messages.compose', 'Compose message')

  const submitLabel = submitting
    ? submitMode === 'draft'
      ? t('messages.savingDraft', 'Saving draft...')
      : t('messages.sending', 'Sending...')
    : variant === 'reply'
      ? t('messages.reply', 'Reply')
      : variant === 'forward'
        ? t('messages.forward', 'Forward')
        : t('messages.send', 'Send')

  return {
    t,
    variant,
    messageId,
    open,
    inline,
    contextPreview,
    isOpen,
    messageTypes,
    createableMessageTypes,
    normalizedRequiredActionMode,
    contextActionOptions,
    shouldShowContextActions,
    isComposePublicVisibility,
    attachmentEntityId,
    attachmentRecordId,
    recipientIds,
    setRecipientIds,
    messageType,
    setMessageType,
    subject,
    setSubject,
    body,
    setBody,
    bodyFormat,
    setBodyFormat,
    priority,
    setPriority,
    visibility,
    setVisibility,
    externalEmail,
    setExternalEmail,
    sendViaEmail,
    setSendViaEmail,
    contextActionRequired,
    setContextActionRequired,
    contextActionType,
    setContextActionType,
    replyAll,
    setReplyAll,
    includeAttachments,
    setIncludeAttachments,
    submitting,
    submitMode,
    submitError,
    composerTitle,
    submitLabel,
    selectedRecipientOptions,
    resolveRecipientLabel,
    loadRecipientSuggestions,
    loadAttachmentIds,
    handleSaveDraft,
    handleBack,
    handleSubmit,
    handleDialogOpenChange,
    handleKeyDown,
  }
}
