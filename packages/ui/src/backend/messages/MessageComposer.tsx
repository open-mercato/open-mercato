"use client"

import * as React from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, FileCode, Globe, Lock, Minus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '../CrudForm'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Switch } from '../../primitives/switch'
import { SwitchableMarkdownInput } from '../inputs/SwitchableMarkdownInput'
import { TagsInput, type TagsInputOption } from '../inputs/TagsInput'
import { flash } from '../FlashMessages'
import { AttachmentsSection } from '../detail/AttachmentsSection'
import { apiCall } from '../utils/apiCall'

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

type UserListItem = {
  id: string
  email?: string | null
  name?: string | null
}

type AttachmentListResponse = {
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
    priority?: 'low' | 'normal' | 'high' | 'urgent'
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

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function MessageComposer({
  variant = 'compose',
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
}: MessageComposerProps) {
  const t = useT()
  const isOpen = inline ? true : Boolean(open)

  const [recipientIds, setRecipientIds] = React.useState<string[]>([])
  const [recipientMap, setRecipientMap] = React.useState<Record<string, TagsInputOption>>({})
  const [messageType, setMessageType] = React.useState(lockedType ?? 'default')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [bodyFormat, setBodyFormat] = React.useState<'text' | 'markdown'>('text')
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
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

  const messageTypes = messageTypesQuery.data ?? []
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
    defaultValues,
    inline,
    isOpen,
    lockedType,
    messageId,
    contextActionOptions,
    contextObject,
    normalizedRequiredActionMode,
    requiredActionConfig?.defaultActionType,
    variant,
  ])

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

  const handleSubmit = React.useCallback(async ({ saveAsDraft = false }: { saveAsDraft?: boolean } = {}) => {
    if (submitting) return false

    setSubmitError(null)

    if (!saveAsDraft && variant === 'forward' && recipientIds.length === 0) {
      const message = t('messages.errors.noRecipients', 'Please add at least one recipient.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    if (!saveAsDraft && variant === 'compose' && visibility !== 'public' && recipientIds.length === 0) {
      const message = t('messages.errors.noRecipients', 'Please add at least one recipient.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    if (!saveAsDraft && variant === 'compose' && visibility === 'public' && !isValidEmailAddress(externalEmail.trim())) {
      const message = t('messages.errors.noExternalEmail', 'Please enter a valid external email.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    if (!saveAsDraft && variant === 'compose' && !subject.trim()) {
      const message = t('messages.errors.noSubject', 'Please enter a subject.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    if (!saveAsDraft && (variant === 'compose' || variant === 'reply') && !body.trim()) {
      const message = t('messages.errors.noBody', 'Please enter a message.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    if (!saveAsDraft && (variant === 'reply' || variant === 'forward') && !messageId) {
      const message = t('messages.errors.invalidContext', 'Message context is missing.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    if (!saveAsDraft && variant === 'compose' && !createableMessageTypes.some((item) => item.type === messageType)) {
      const message = t('messages.errors.sendFailed', 'Failed to send message.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }
    if (
      !saveAsDraft
      && shouldShowContextActions
      && normalizedRequiredActionMode === 'required'
      && !contextActionType
    ) {
      const message = t('messages.composer.objectPicker.errors.actionRequired', 'Select an action.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }
    if (
      !saveAsDraft
      && shouldShowContextActions
      && normalizedRequiredActionMode === 'optional'
      && contextActionRequired
      && !contextActionType
    ) {
      const message = t('messages.composer.objectPicker.errors.actionRequired', 'Select an action.')
      setSubmitError(message)
      flash(message, 'error')
      return false
    }

    setSubmitMode(saveAsDraft ? 'draft' : 'send')
    setSubmitting(true)

    try {
      let endpoint = '/api/messages'
      let payload: Record<string, unknown> = {}

      let nextAttachmentIds = attachmentIds
      if (variant === 'compose' || variant === 'reply') {
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

      if (variant === 'compose') {
        const publicMessage = visibility === 'public'
        const sourceEntityType = contextObject?.sourceEntityType ?? defaultValues?.sourceEntityType
        const sourceEntityId = contextObject?.sourceEntityId ?? defaultValues?.sourceEntityId
        const selectedContextActionOption = contextActionOptions.find((option) => option.id === contextActionType)
        const resolvedContextActionRequired = shouldShowContextActions
          ? (normalizedRequiredActionMode === 'required' ? true : contextActionRequired)
          : (contextObject?.actionRequired ?? false)
        const resolvedContextActionType = resolvedContextActionRequired
          ? (shouldShowContextActions ? contextActionType : contextObject?.actionType)
          : undefined
        const resolvedContextActionLabel = resolvedContextActionRequired
          ? (shouldShowContextActions ? selectedContextActionOption?.label : contextObject?.actionLabel)
          : undefined
        const contextObjects = contextObject
          ? [{
            entityModule: contextObject.entityModule,
            entityType: contextObject.entityType,
            entityId: contextObject.entityId,
            actionRequired: resolvedContextActionRequired,
            actionType: resolvedContextActionType,
            actionLabel: resolvedContextActionLabel,
          }]
          : undefined
        endpoint = '/api/messages'
        payload = {
          type: messageType,
          priority,
          visibility,
          externalEmail: publicMessage ? externalEmail.trim() : undefined,
          externalName: undefined,
          recipients: publicMessage ? [] : recipientIds.map((userId) => ({ userId, type: 'to' })),
          subject: subject.trim(),
          body,
          bodyFormat,
          sourceEntityType: sourceEntityType ?? undefined,
          sourceEntityId: sourceEntityId ?? undefined,
          objects: contextObjects,
          attachmentIds: nextAttachmentIds.length > 0 ? nextAttachmentIds : undefined,
          sendViaEmail: publicMessage ? true : sendViaEmail,
          isDraft: saveAsDraft,
        }
      } else if (variant === 'reply') {
        endpoint = `/api/messages/${encodeURIComponent(messageId!)}/reply`
        payload = {
          body,
          bodyFormat,
          replyAll,
          recipients: recipientIds.length > 0 ? recipientIds.map((userId) => ({ userId, type: 'to' })) : undefined,
          attachmentIds: nextAttachmentIds.length > 0 ? nextAttachmentIds : undefined,
          sendViaEmail,
        }
      } else {
        endpoint = `/api/messages/${encodeURIComponent(messageId!)}/forward`
        payload = {
          recipients: recipientIds.map((userId) => ({ userId, type: 'to' })),
          additionalBody: body.trim() || undefined,
          includeAttachments,
          sendViaEmail,
        }
      }

      const call = await apiCall<{ id?: string }>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!call.ok) {
        const message = toErrorMessage(call.result) ?? t('messages.errors.sendFailed', 'Failed to send message.')
        setSubmitError(message)
        flash(message, 'error')
        return
      }

      flash(
        saveAsDraft
          ? t('messages.flash.draftSaved', 'Draft saved.')
          : variant === 'reply'
          ? t('messages.flash.replySuccess', 'Reply sent.')
          : variant === 'forward'
            ? t('messages.flash.forwardSuccess', 'Message forwarded.')
            : t('messages.flash.sentSuccess', 'Message sent.'),
        'success',
      )

      onSuccess?.({ id: call.result?.id })

      if (!inline) {
        onOpenChange?.(false)
      }
      return true
    } catch (err) {
      const message = err instanceof Error
        ? err.message
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
    body,
    bodyFormat,
    externalEmail,
    includeAttachments,
    inline,
    messageId,
    messageType,
    normalizedRequiredActionMode,
    onOpenChange,
    onSuccess,
    contextObject,
    contextActionOptions,
    contextActionRequired,
    contextActionType,
    defaultValues?.sourceEntityType,
    defaultValues?.sourceEntityId,
    loadAttachmentIds,
    priority,
    recipientIds,
    replyAll,
    sendViaEmail,
    shouldShowContextActions,
    createableMessageTypes,
    subject,
    submitting,
    t,
    variant,
    visibility,
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
  const inlineExtraActions = inline && variant === 'compose'
    ? (
      <Button
        type="button"
        variant="outline"
        onClick={handleSaveDraft}
        disabled={submitting}
      >
        {t('messages.saveDraft', 'Save draft')}
      </Button>
    )
    : null
  const dialogExtraActions = !inline
    ? (
      <>
        {variant === 'compose' ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={submitting}
          >
            {t('messages.saveDraft', 'Save draft')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={handleBack}
          disabled={submitting}
        >
          {t('ui.forms.actions.cancel', 'Cancel')}
        </Button>
      </>
    )
    : null
  const priorityOptions = [
    { value: 'low' as const, label: t('messages.priority.low', 'Low'), icon: ArrowDown },
    { value: 'normal' as const, label: t('messages.priority.normal', 'Normal'), icon: Minus },
    { value: 'high' as const, label: t('messages.priority.high', 'High'), icon: ArrowUp },
    { value: 'urgent' as const, label: t('messages.priority.urgent', 'Urgent'), icon: AlertTriangle },
  ]
  const selectedPriorityLabel = priorityOptions.find((option) => option.value === priority)?.label
    ?? t('messages.priority.normal', 'Normal')

  const composerFields: CrudField[] = [{
    id: 'composer',
    label: '',
    type: 'custom',
    component: () => (
      <div className="space-y-4" onKeyDown={handleKeyDown}>
        {variant === 'compose' && contextPreview ? (
          <div className="rounded border bg-muted/30 p-3 text-sm">
            {contextPreview}
          </div>
        ) : null}

        {variant === 'compose' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                {visibility === 'public' ? (
                  <>
                    <Label htmlFor="messages-compose-external-email">{t('messages.externalEmail', 'External email')}</Label>
                    <Input
                      id="messages-compose-external-email"
                      type="email"
                      value={externalEmail}
                      onChange={(event) => setExternalEmail(event.target.value)}
                      placeholder={t('messages.placeholders.externalEmail', 'name@example.com')}
                    />
                  </>
                ) : (
                  <>
                    <Label htmlFor="messages-compose-recipients">{t('messages.to', 'To')}</Label>
                    <TagsInput
                      value={recipientIds}
                      onChange={setRecipientIds}
                      selectedOptions={selectedRecipientOptions}
                      resolveLabel={resolveRecipientLabel}
                      loadSuggestions={loadRecipientSuggestions}
                      placeholder={t('messages.placeholders.recipients', 'Search recipients...')}
                      allowCustomValues={false}
                    />
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('messages.visibility', 'Visibility')}</Label>
                <div
                  className="inline-flex items-center gap-1 rounded-md border bg-background p-1"
                  role="radiogroup"
                  aria-label={t('messages.visibility', 'Visibility')}
                >
                  <Button
                    type="button"
                    size="icon"
                    variant={visibility === 'internal' ? 'secondary' : 'ghost'}
                    role="radio"
                    aria-checked={visibility === 'internal'}
                    aria-label={t('messages.visibilityInternal', 'Internal')}
                    title={t('messages.visibilityInternal', 'Internal')}
                    className="h-7 w-7"
                    onClick={() => setVisibility('internal')}
                  >
                    <Lock className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant={visibility === 'public' ? 'secondary' : 'ghost'}
                    role="radio"
                    aria-checked={visibility === 'public'}
                    aria-label={t('messages.visibilityPublic', 'Public')}
                    title={t('messages.visibilityPublic', 'Public')}
                    className="h-7 w-7"
                    onClick={() => setVisibility('public')}
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {visibility === 'public'
                    ? t('messages.visibilityPublicHint', 'Public messages are sent to external email only.')
                    : t('messages.visibilityInternalHint', 'Internal messages are sent to selected system users.')}
                </p>
              </div>
            </div>
            {shouldShowContextActions ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {normalizedRequiredActionMode === 'optional' ? (
                  <div className="flex items-center justify-between rounded border px-3 py-2 sm:col-span-2">
                    <div>
                      <p className="text-sm font-medium">
                        {t('messages.composer.objectPicker.actionRequiredLabel', 'Action required')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('messages.composer.objectPicker.actionRequiredHint', 'Mark this object as requiring recipient action.')}
                      </p>
                    </div>
                    <Switch checked={contextActionRequired} onCheckedChange={setContextActionRequired} />
                  </div>
                ) : null}
                {normalizedRequiredActionMode === 'required' || contextActionRequired ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="messages-compose-context-action-type">
                      {t('messages.composer.objectPicker.actionTypeLabel', 'Action type')}
                    </Label>
                    <select
                      id="messages-compose-context-action-type"
                      value={contextActionType}
                      onChange={(event) => setContextActionType(event.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">{t('messages.composer.objectPicker.actionTypePlaceholder', 'Select action')}</option>
                      {contextActionOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {variant === 'forward' ? (
          <div className="space-y-2">
            <Label htmlFor="messages-compose-recipients">{t('messages.to', 'To')}</Label>
            <TagsInput
              value={recipientIds}
              onChange={setRecipientIds}
              selectedOptions={selectedRecipientOptions}
              resolveLabel={resolveRecipientLabel}
              loadSuggestions={loadRecipientSuggestions}
              placeholder={t('messages.placeholders.recipients', 'Search recipients...')}
              allowCustomValues={false}
            />
          </div>
        ) : null}

        {variant === 'compose' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="messages-compose-subject">{t('messages.subject', 'Subject')}</Label>
              <Input
                id="messages-compose-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t('messages.placeholders.subject', 'Enter subject...')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('messages.priority', 'Priority')}</Label>
              <div
                className="inline-flex items-center gap-1 rounded-md border bg-background p-1"
                role="radiogroup"
                aria-label={t('messages.priority', 'Priority')}
                tabIndex={0}
                onKeyDown={(event) => {
                  const currentIndex = priorityOptions.findIndex((option) => option.value === priority)
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    const nextIndex = (currentIndex + 1) % priorityOptions.length
                    setPriority(priorityOptions[nextIndex]!.value)
                    return
                  }
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    const nextIndex = (currentIndex - 1 + priorityOptions.length) % priorityOptions.length
                    setPriority(priorityOptions[nextIndex]!.value)
                  }
                }}
              >
                {priorityOptions.map((option) => {
                  const Icon = option.icon
                  const isSelected = priority === option.value
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      size="icon"
                      variant={isSelected ? 'secondary' : 'ghost'}
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={option.label}
                      title={option.label}
                      className={`h-7 w-7 ${isSelected ? 'ring-1 ring-primary/40' : ''}`}
                      onClick={() => setPriority(option.value)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">{selectedPriorityLabel}</p>
            </div>
          </div>
        ) : null}

        {(variant === 'compose' || variant === 'reply') ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="messages-compose-body">
                {variant === 'reply' ? t('messages.replyBody', 'Reply') : t('messages.body', 'Message')}
              </Label>
              <Button
                type="button"
                size="icon"
                variant={bodyFormat === 'markdown' ? 'secondary' : 'ghost'}
                aria-pressed={bodyFormat === 'markdown'}
                onClick={() => setBodyFormat((prev) => (prev === 'markdown' ? 'text' : 'markdown'))}
                title={t('messages.bodyFormat.toggle', 'Toggle markdown')}
              >
                <FileCode className="h-4 w-4" />
              </Button>
            </div>
            <div id="messages-compose-body">
              <SwitchableMarkdownInput
                value={body}
                onChange={setBody}
                isMarkdownEnabled={bodyFormat === 'markdown'}
                rows={8}
                placeholder={
                  variant === 'reply'
                    ? t('messages.placeholders.replyBody', 'Write your reply...')
                    : t('messages.placeholders.body', 'Write your message...')
                }
                textareaClassName="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
        ) : null}

        {variant === 'forward' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="messages-forward-note">{t('messages.forwardNote', 'Optional note')}</Label>
              <Button
                type="button"
                size="icon"
                variant={bodyFormat === 'markdown' ? 'secondary' : 'ghost'}
                aria-pressed={bodyFormat === 'markdown'}
                onClick={() => setBodyFormat((prev) => (prev === 'markdown' ? 'text' : 'markdown'))}
                title={t('messages.bodyFormat.toggle', 'Toggle markdown')}
              >
                <FileCode className="h-4 w-4" />
              </Button>
            </div>
            <div id="messages-forward-note">
              <SwitchableMarkdownInput
                value={body}
                onChange={setBody}
                isMarkdownEnabled={bodyFormat === 'markdown'}
                rows={6}
                placeholder={t('messages.placeholders.forwardBody', 'Add context before forwarding...')}
                textareaClassName="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
        ) : null}

        {(variant === 'compose' || variant === 'reply') ? (
          <div className="space-y-2">
            <Label>{t('messages.attachedFiles', 'Attachments')}</Label>
            <AttachmentsSection
              entityId={attachmentEntityId}
              recordId={attachmentRecordId}
              showHeader={false}
              onChanged={() => {
                void loadAttachmentIds().catch(() => null)
              }}
            />
          </div>
        ) : null}

        {variant === 'reply' ? (
          <div className="flex items-center justify-between rounded border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t('messages.replyAll', 'Reply all')}</p>
              <p className="text-xs text-muted-foreground">{t('messages.replyAllHint', 'Include all original recipients.')}</p>
            </div>
            <Switch checked={replyAll} onCheckedChange={setReplyAll} />
          </div>
        ) : null}

        {variant === 'forward' ? (
          <div className="flex items-center justify-between rounded border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t('messages.includeAttachments', 'Include attachments')}</p>
              <p className="text-xs text-muted-foreground">{t('messages.includeAttachmentsHint', 'Carry over attachments from the original message.')}</p>
            </div>
            <Switch checked={includeAttachments} onCheckedChange={setIncludeAttachments} />
          </div>
        ) : null}

        {isComposePublicVisibility ? (
          <div className="rounded border px-3 py-2">
            <p className="text-sm font-medium">{t('messages.sendViaEmail', 'Also send via email')}</p>
            <p className="text-xs text-muted-foreground">{t('messages.sendViaEmailForcedPublic', 'For public visibility, email delivery is always enabled.')}</p>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t('messages.sendViaEmail', 'Also send via email')}</p>
              <p className="text-xs text-muted-foreground">{t('messages.sendViaEmailHint', 'Recipients will receive an email copy with a secure link.')}</p>
            </div>
            <Switch checked={sendViaEmail} onCheckedChange={setSendViaEmail} />
          </div>
        )}

        {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
      </div>
    ),
  }]

  const backHref = inline ? '/backend/messages' : ""

  const composePanel = (
    <>
      <CrudForm<Record<string, unknown>>
        backHref={backHref}
        title={composerTitle}
        fields={composerFields}
        initialValues={{}}
        submitLabel={submitLabel}
        extraActions={inline ? inlineExtraActions : dialogExtraActions}
        hideFooterActions
        onSubmit={async () => {
          await handleSubmit()
        }}
      />
    </>
  )

  if (inline) {
    return (
      <div className="space-y-4">
        {composePanel}
      </div>
    )
  }

  return (
    <Dialog open={Boolean(open)} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-3xl [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{composerTitle}</DialogTitle>
        </DialogHeader>
        {composePanel}
      </DialogContent>
    </Dialog>
  )
}
