"use client"

import * as React from 'react'
import { Loader2, Paperclip, Send, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Switch } from '../../primitives/switch'
import { Textarea } from '../../primitives/textarea'
import { TagsInput, type TagsInputOption } from '../inputs/TagsInput'
import { flash } from '../FlashMessages'
import { apiCall } from '../utils/apiCall'
import {
  MessageAttachmentPicker,
  type MessageAttachmentPickerItem,
} from './MessageAttachmentPicker'
import {
  ObjectAttachmentPicker,
  type MessageObjectInput,
  type MessageObjectTypeItem,
} from './ObjectAttachmentPicker'

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

export type MessageComposerVariant = 'compose' | 'reply' | 'forward'

export type MessageComposerProps = {
  variant?: MessageComposerVariant
  messageId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  inline?: boolean
  lockedType?: string | null
  defaultValues?: {
    type?: string
    recipients?: string[]
    subject?: string
    body?: string
    visibility?: 'public' | 'internal'
    sourceEntityType?: string | null
    sourceEntityId?: string | null
    externalEmail?: string | null
    externalName?: string | null
    objects?: MessageObjectInput[]
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
  const [visibility, setVisibility] = React.useState<'public' | 'internal'>('internal')
  const [externalEmail, setExternalEmail] = React.useState('')
  const [objects, setObjects] = React.useState<MessageObjectInput[]>([])
  const [attachments, setAttachments] = React.useState<MessageAttachmentPickerItem[]>([])
  const [sendViaEmail, setSendViaEmail] = React.useState(false)
  const [replyAll, setReplyAll] = React.useState(false)
  const [includeAttachments, setIncludeAttachments] = React.useState(true)
  const [objectPickerOpen, setObjectPickerOpen] = React.useState(false)
  const [attachmentPickerOpen, setAttachmentPickerOpen] = React.useState(false)
  const [pendingPreviousMessageType, setPendingPreviousMessageType] = React.useState<string | null>(null)
  const [temporaryAttachmentRecordId, setTemporaryAttachmentRecordId] = React.useState<string>(() =>
    createTemporaryAttachmentRecordId(),
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [submittingMode, setSubmittingMode] = React.useState<'send' | 'draft'>('send')
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const attachObjectTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const attachFileTriggerRef = React.useRef<HTMLButtonElement | null>(null)

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

  const objectTypesQuery = useQuery({
    queryKey: ['messages', 'object-types', messageType],
    enabled: variant === 'compose' && isOpen && Boolean(messageType.trim()),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('messageType', messageType)
      const call = await apiCall<{ items?: MessageObjectTypeItem[] }>(
        `/api/messages/object-types?${params.toString()}`,
      )
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadObjectTypesFailed', 'Failed to load object types.'),
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
  const objectTypes = objectTypesQuery.data ?? []

  const selectedMessageType = React.useMemo(() => {
    return createableMessageTypes.find((item) => item.type === messageType) ?? null
  }, [createableMessageTypes, messageType])
  const isComposePublicVisibility = variant === 'compose' && visibility === 'public'

  const attachmentIds = React.useMemo(
    () => attachments.map((item) => item.id),
    [attachments],
  )

  const attachmentEntityId = variant === 'compose' && messageId ? 'messages:message' : 'attachments:library'
  const attachmentRecordId = variant === 'compose' && messageId ? messageId : temporaryAttachmentRecordId

  React.useEffect(() => {
    if (!isOpen) return

    const nextRecipients = defaultValues?.recipients?.filter((value) => typeof value === 'string' && value.trim().length > 0) ?? []
    const dedupedRecipients = Array.from(new Set(nextRecipients))

    setRecipientIds(dedupedRecipients)
    setMessageType(lockedType ?? defaultValues?.type ?? 'default')
    setSubject(defaultValues?.subject ?? '')
    setBody(defaultValues?.body ?? '')
    setVisibility(defaultValues?.visibility ?? 'internal')
    setExternalEmail(defaultValues?.externalEmail ?? '')
    setObjects(Array.isArray(defaultValues?.objects) ? defaultValues?.objects ?? [] : [])
    if (Array.isArray(defaultValues?.attachmentIds)) {
      const initialAttachments: MessageAttachmentPickerItem[] = []
      for (const attachmentId of defaultValues?.attachmentIds ?? []) {
        if (typeof attachmentId !== 'string' || !attachmentId.trim().length) continue
        initialAttachments.push({
          id: attachmentId,
          fileName: attachmentId,
          fileSize: 0,
          mimeType: null,
          url: '',
        })
      }
      setAttachments(initialAttachments)
    } else {
      setAttachments([])
    }
    setSendViaEmail(Boolean(defaultValues?.sendViaEmail))
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
    variant,
  ])

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

  React.useEffect(() => {
    if (variant !== 'compose') return
    if (!pendingPreviousMessageType) return
    if (objectTypesQuery.isLoading) return
    if (objectTypesQuery.isError) {
      setPendingPreviousMessageType(null)
      return
    }

    const allowedKeys = new Set(objectTypes.map((item) => `${item.module}:${item.entityType}`))
    const incompatibleCount = objects.filter((item) => !allowedKeys.has(`${item.entityModule}:${item.entityType}`)).length

    if (incompatibleCount === 0) {
      setPendingPreviousMessageType(null)
      return
    }

    const shouldRemove = window.confirm(
      t(
        'messages.composer.confirm.incompatibleObjects',
        'Changing message type will remove {count} incompatible attached objects. Continue?',
        { count: incompatibleCount },
      ),
    )

    if (!shouldRemove) {
      const previousType = pendingPreviousMessageType
      setPendingPreviousMessageType(null)
      setMessageType(previousType)
      return
    }

    setObjects((prev) =>
      prev.filter((item) => allowedKeys.has(`${item.entityModule}:${item.entityType}`)),
    )
    setPendingPreviousMessageType(null)
  }, [
    objectTypes,
    objectTypesQuery.isError,
    objectTypesQuery.isLoading,
    objects,
    pendingPreviousMessageType,
    t,
    variant,
  ])

  const objectTypeMap = React.useMemo(() => {
    const map = new Map<string, MessageObjectTypeItem>()
    for (const item of objectTypes) {
      map.set(`${item.module}:${item.entityType}`, item)
    }
    return map
  }, [objectTypes])

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

  const handleSubmit = React.useCallback(async (mode: 'send' | 'draft' = 'send') => {
    if (submitting) return
    const saveAsDraft = variant === 'compose' && mode === 'draft'

    setSubmitError(null)

    if (!saveAsDraft && variant === 'forward' && recipientIds.length === 0) {
      const message = t('messages.errors.noRecipients', 'Please add at least one recipient.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    if (!saveAsDraft && variant === 'compose' && visibility !== 'public' && recipientIds.length === 0) {
      const message = t('messages.errors.noRecipients', 'Please add at least one recipient.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    if (!saveAsDraft && variant === 'compose' && visibility === 'public' && !isValidEmailAddress(externalEmail.trim())) {
      const message = t('messages.errors.noExternalEmail', 'Please enter a valid external email.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    if (!saveAsDraft && variant === 'compose' && !subject.trim()) {
      const message = t('messages.errors.noSubject', 'Please enter a subject.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    if (!saveAsDraft && (variant === 'compose' || variant === 'reply') && !body.trim()) {
      const message = t('messages.errors.noBody', 'Please enter a message.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    if ((variant === 'reply' || variant === 'forward') && !messageId) {
      const message = t('messages.errors.invalidContext', 'Message context is missing.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    if (!saveAsDraft && variant === 'compose' && !createableMessageTypes.some((item) => item.type === messageType)) {
      const message = t('messages.errors.sendFailed', 'Failed to send message.')
      setSubmitError(message)
      flash(message, 'error')
      return
    }

    setSubmittingMode(mode)
    setSubmitting(true)

    try {
      let endpoint = '/api/messages'
      let payload: Record<string, unknown> = {}

      if (variant === 'compose') {
        const publicMessage = visibility === 'public'
        endpoint = '/api/messages'
        payload = {
          type: messageType,
          visibility,
          externalEmail: publicMessage ? externalEmail.trim() : undefined,
          externalName: undefined,
          recipients: publicMessage ? [] : recipientIds.map((userId) => ({ userId, type: 'to' })),
          subject: subject.trim(),
          body,
          objects: objects.length > 0 ? objects : undefined,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          sendViaEmail: publicMessage ? true : sendViaEmail,
          isDraft: saveAsDraft,
        }
      } else if (variant === 'reply') {
        endpoint = `/api/messages/${encodeURIComponent(messageId!)}/reply`
        payload = {
          body,
          replyAll,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
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
        variant === 'reply'
          ? t('messages.flash.replySuccess', 'Reply sent.')
          : variant === 'forward'
            ? t('messages.flash.forwardSuccess', 'Message forwarded.')
            : saveAsDraft
              ? t('messages.flash.draftSaved', 'Draft saved.')
              : t('messages.flash.sentSuccess', 'Message sent.'),
        'success',
      )

      onSuccess?.({ id: call.result?.id })

      if (!inline) {
        onOpenChange?.(false)
      }
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('messages.errors.sendFailed', 'Failed to send message.')
      setSubmitError(message)
      flash(message, 'error')
    } finally {
      setSubmittingMode('send')
      setSubmitting(false)
    }
  }, [
    attachmentIds,
    body,
    externalEmail,
    includeAttachments,
    inline,
    messageId,
    messageType,
    objects,
    onOpenChange,
    onSuccess,
    recipientIds,
    replyAll,
    sendViaEmail,
    createableMessageTypes,
    subject,
    submitting,
    t,
    variant,
    visibility,
  ])

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

  const removeAttachment = React.useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((entry) => entry.id !== attachmentId))
  }, [])

  const composerTitle = variant === 'reply'
    ? t('messages.reply', 'Reply')
    : variant === 'forward'
      ? t('messages.forward', 'Forward')
      : t('messages.compose', 'Compose message')

  const submitLabel = submitting
    ? submittingMode === 'draft'
      ? t('messages.savingDraft', 'Saving draft...')
      : t('messages.sending', 'Sending...')
    : variant === 'reply'
      ? t('messages.reply', 'Reply')
      : variant === 'forward'
        ? t('messages.forward', 'Forward')
        : t('messages.send', 'Send')

  const composePanel = (
    <div className="space-y-4" onKeyDown={handleKeyDown}>
      {variant === 'compose' ? (
        <div className="space-y-2">
          <Label htmlFor="messages-compose-type">{t('messages.fields.type', 'Message type')}</Label>
          <select
            id="messages-compose-type"
            value={messageType}
            onChange={(event) => {
              const nextType = event.target.value
              if (nextType === messageType) return
              setPendingPreviousMessageType(messageType)
              setMessageType(nextType)
            }}
            disabled={Boolean(lockedType) || messageTypesQuery.isLoading}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {!createableMessageTypes.length ? (
              <option value="default">{t('messages.types.default', 'Message')}</option>
            ) : null}
            {createableMessageTypes.map((item) => (
              <option key={item.type} value={item.type}>
                {t(item.labelKey, item.type)}
              </option>
            ))}
          </select>
          {messageTypesQuery.isError ? (
            <p className="text-xs text-destructive">
              {toErrorMessage((messageTypesQuery.error as Error | null)?.message)
                ?? t('messages.errors.loadTypesFailed', 'Failed to load message types.')}
            </p>
          ) : null}
          {selectedMessageType?.actionsExpireAfterHours ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'messages.composer.hints.actionExpiry',
                'Actions for this type expire after {hours} hours.',
                { hours: selectedMessageType.actionsExpireAfterHours },
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {variant === 'compose' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="messages-compose-visibility">{t('messages.visibility', 'Visibility')}</Label>
            <select
              id="messages-compose-visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as 'public' | 'internal')}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="internal">{t('messages.visibilityInternal', 'Internal')}</option>
              <option value="public">{t('messages.visibilityPublic', 'Public')}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {visibility === 'public'
                ? t('messages.visibilityPublicHint', 'Public messages are sent to external email only.')
                : t('messages.visibilityInternalHint', 'Internal messages are sent to selected system users.')}
            </p>
          </div>

          {visibility === 'public' ? (
            <div className="space-y-2">
              <Label htmlFor="messages-compose-external-email">{t('messages.externalEmail', 'External email')}</Label>
              <Input
                id="messages-compose-external-email"
                type="email"
                value={externalEmail}
                onChange={(event) => setExternalEmail(event.target.value)}
                placeholder={t('messages.placeholders.externalEmail', 'name@example.com')}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {(variant === 'forward' || (variant === 'compose' && visibility === 'internal')) ? (
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
        <div className="space-y-2">
          <Label htmlFor="messages-compose-subject">{t('messages.subject', 'Subject')}</Label>
          <Input
            id="messages-compose-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t('messages.placeholders.subject', 'Enter subject...')}
          />
        </div>
      ) : null}

      {(variant === 'compose' || variant === 'reply') ? (
        <div className="space-y-2">
          <Label htmlFor="messages-compose-body">
            {variant === 'reply' ? t('messages.replyBody', 'Reply') : t('messages.body', 'Message')}
          </Label>
          <Textarea
            id="messages-compose-body"
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              variant === 'reply'
                ? t('messages.placeholders.replyBody', 'Write your reply...')
                : t('messages.placeholders.body', 'Write your message...')
            }
          />
        </div>
      ) : null}

      {variant === 'forward' ? (
        <div className="space-y-2">
          <Label htmlFor="messages-forward-note">{t('messages.forwardNote', 'Optional note')}</Label>
          <Textarea
            id="messages-forward-note"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('messages.placeholders.forwardBody', 'Add context before forwarding...')}
          />
        </div>
      ) : null}

      {variant === 'compose' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t('messages.attachedObjects', 'Attached objects')}</Label>
            <Button
              ref={attachObjectTriggerRef}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setObjectPickerOpen(true)}
              disabled={
                objectTypesQuery.isLoading
                || objectTypesQuery.isError
                || !messageType.trim()
                || objectTypes.length === 0
              }
            >
              <Paperclip className="mr-1 h-4 w-4" />
              {t('messages.attachObject', 'Attach object')}
            </Button>
          </div>

          {objectTypesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">{t('messages.loading.objectTypes', 'Loading object types...')}</p>
          ) : null}

          {objectTypesQuery.isError ? (
            <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <p>{t('messages.errors.loadObjectTypesFailed', 'Failed to load object types.')}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void objectTypesQuery.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          ) : null}

          {!objectTypesQuery.isLoading && !objectTypesQuery.isError && objectTypes.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {t('messages.composer.noObjectTypesForMessageType', 'No object types are available for this message type.')}
            </p>
          ) : null}

          {objects.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {t('messages.composer.noObjects', 'No objects attached yet.')}
            </p>
          ) : (
            <div className="space-y-2">
              {objects.map((item, index) => {
                const key = `${item.entityModule}:${item.entityType}`
                const objectType = objectTypeMap.get(key)
                const label = objectType ? t(objectType.labelKey, key) : item.entityType
                return (
                  <div key={`${key}:${item.entityId}:${index}`} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{label}</p>
                      <p className="truncate text-xs text-muted-foreground" title={item.entityId}>
                        {item.entityId}
                      </p>
                      {item.actionRequired ? (
                        <p className="text-xs text-amber-700">
                          {item.actionLabel
                            ? t('messages.composer.objectAction', 'Action: {action}', { action: item.actionLabel })
                            : t('messages.composer.objectActionRequired', 'Action required')}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setObjects((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
                      }}
                      aria-label={t('messages.composer.removeObject', 'Remove attached object')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {objects.length >= 25 ? (
            <p className="text-xs text-amber-700">
              {t('messages.composer.maxObjectsWarning', 'You reached the recommended limit of 25 attached objects.')}
            </p>
          ) : null}
        </div>
      ) : null}

      {(variant === 'compose' || variant === 'reply') ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t('messages.attachedFiles', 'Attachments')}</Label>
            <Button
              ref={attachFileTriggerRef}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAttachmentPickerOpen(true)}
            >
              <Paperclip className="mr-1 h-4 w-4" />
              {t('messages.attachFiles', 'Attach files')}
            </Button>
          </div>

          {attachments.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {t('messages.composer.noAttachments', 'No files attached yet.')}
            </p>
          ) : (
            <div className="space-y-2">
              {attachments.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.fileName || item.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.fileSize > 0 ? `${Math.max(1, Math.round(item.fileSize / 1024))} KB` : item.id}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeAttachment(item.id)}
                    aria-label={t('messages.composer.removeAttachment', 'Remove attached file')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
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

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
          {t('common.cancel', 'Cancel')}
        </Button>
        {variant === 'compose' ? (
          <Button type="button" variant="secondary" onClick={() => void handleSubmit('draft')} disabled={submitting}>
            {submitting && submittingMode === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('messages.actions.saveDraft', 'Save draft')}
          </Button>
        ) : null}
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting && submittingMode !== 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {submitLabel}
        </Button>
      </div>

      {(variant === 'compose' || variant === 'reply') ? (
        <MessageAttachmentPicker
          open={attachmentPickerOpen}
          onOpenChange={setAttachmentPickerOpen}
          entityId={attachmentEntityId}
          recordId={attachmentRecordId}
          selectedAttachments={attachments}
          onConfirm={setAttachments}
          triggerRef={attachFileTriggerRef}
        />
      ) : null}

      {variant === 'compose' ? (
        <ObjectAttachmentPicker
          open={objectPickerOpen}
          onOpenChange={setObjectPickerOpen}
          messageType={messageType}
          objectTypes={objectTypes}
          existingObjects={objects}
          onConfirm={(value) => {
            setObjects((prev) => [...prev, value])
          }}
          triggerRef={attachObjectTriggerRef}
        />
      ) : null}
    </div>
  )

  if (inline) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{composerTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {t('messages.composer.shortcuts', 'Use Cmd/Ctrl + Enter to submit and Escape to cancel.')}
          </p>
        </div>
        {composePanel}
      </div>
    )
  }

  return (
    <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{composerTitle}</DialogTitle>
        </DialogHeader>
        {composePanel}
      </DialogContent>
    </Dialog>
  )
}
