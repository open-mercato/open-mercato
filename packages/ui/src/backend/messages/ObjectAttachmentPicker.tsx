"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Switch } from '../../primitives/switch'
import { apiCall } from '../utils/apiCall'
import { MessageObjectRecordPicker, type MessageObjectOptionItem } from './MessageObjectRecordPicker'

export type { MessageObjectOptionItem } from './MessageObjectRecordPicker'

export type MessageObjectTypeAction = {
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

export type MessageObjectTypeItem = {
  module: string
  entityType: string
  labelKey: string
  icon?: string
  actions: MessageObjectTypeAction[]
}

export type MessageObjectInput = {
  entityModule: string
  entityType: string
  entityId: string
  actionRequired: boolean
  actionType?: string
  actionLabel?: string
}

export type ObjectAttachmentPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  messageType: string
  objectTypes: MessageObjectTypeItem[]
  existingObjects: MessageObjectInput[]
  onConfirm: (value: MessageObjectInput) => void
  maxObjects?: number
  triggerRef?: React.RefObject<HTMLElement | null>
  preferredActionIds?: string[]
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

function normalizeObjectKey(item: Pick<MessageObjectInput, 'entityModule' | 'entityType' | 'entityId'>): string {
  return `${item.entityModule}:${item.entityType}:${item.entityId}`.toLowerCase()
}

export function ObjectAttachmentPicker({
  open,
  onOpenChange,
  messageType,
  objectTypes,
  existingObjects,
  onConfirm,
  maxObjects = 25,
  triggerRef,
  preferredActionIds = [],
}: ObjectAttachmentPickerProps) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [selectedTypeKey, setSelectedTypeKey] = React.useState('')
  const [recordSearch, setRecordSearch] = React.useState('')
  const [selectedRecordId, setSelectedRecordId] = React.useState('')
  const [actionRequired, setActionRequired] = React.useState(false)
  const [actionType, setActionType] = React.useState('')
  const [typeError, setTypeError] = React.useState<string | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)
  const [actionTypeError, setActionTypeError] = React.useState<string | null>(null)
  const [globalError, setGlobalError] = React.useState<string | null>(null)

  const wasOpenRef = React.useRef(false)

  React.useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        window.setTimeout(() => {
          triggerRef?.current?.focus()
        }, 0)
      }
      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true
    setSearch('')
    setSelectedTypeKey('')
    setRecordSearch('')
    setSelectedRecordId('')
    setActionRequired(false)
    setActionType('')
    setTypeError(null)
    setRecordError(null)
    setActionTypeError(null)
    setGlobalError(null)
  }, [open, triggerRef])

  const filteredObjectTypes = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return objectTypes
    return objectTypes.filter((item) => {
      const key = `${item.module}:${item.entityType}`.toLowerCase()
      const labelKey = item.labelKey.toLowerCase()
      return key.includes(query) || labelKey.includes(query)
    })
  }, [objectTypes, search])

  const selectedType = React.useMemo(() => {
    return objectTypes.find((item) => `${item.module}:${item.entityType}` === selectedTypeKey) ?? null
  }, [objectTypes, selectedTypeKey])

  const objectOptionsQuery = useQuery({
    queryKey: ['messages', 'object-options', messageType, selectedTypeKey, recordSearch],
    enabled: open && Boolean(messageType.trim()) && Boolean(selectedType),
    staleTime: 30 * 1000,
    queryFn: async () => {
      const selected = selectedType
      if (!selected) return [] as MessageObjectOptionItem[]

      const params = new URLSearchParams()
      params.set('messageType', messageType)
      params.set('entityModule', selected.module)
      params.set('entityType', selected.entityType)
      params.set('page', '1')
      params.set('pageSize', '50')
      if (recordSearch.trim().length) {
        params.set('search', recordSearch.trim())
      }

      const call = await apiCall<{ items?: MessageObjectOptionItem[] }>(
        `/api/messages/object-options?${params.toString()}`,
      )
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadObjectOptionsFailed', 'Failed to load object options.'),
        )
      }

      return Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    },
  })

  const objectOptions = objectOptionsQuery.data ?? []
  const selectedRecord = React.useMemo(
    () => objectOptions.find((item) => item.id === selectedRecordId) ?? null,
    [objectOptions, selectedRecordId],
  )

  const sortedActions = React.useMemo(() => {
    if (!selectedType) return []
    if (!preferredActionIds.length) return selectedType.actions

    const priority = new Map(preferredActionIds.map((value, index) => [value, index]))
    return [...selectedType.actions].sort((a, b) => {
      const pa = priority.get(a.id)
      const pb = priority.get(b.id)
      if (pa == null && pb == null) return a.id.localeCompare(b.id)
      if (pa == null) return 1
      if (pb == null) return -1
      return pa - pb
    })
  }, [preferredActionIds, selectedType])

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleConfirm = React.useCallback(() => {
    setTypeError(null)
    setRecordError(null)
    setActionTypeError(null)
    setGlobalError(null)

    if (!messageType.trim()) {
      setGlobalError(
        t(
          'messages.composer.objectPicker.errors.messageTypeRequired',
          'Select a message type before attaching objects.',
        ),
      )
      return
    }

    if (!selectedType) {
      setTypeError(t('messages.composer.objectPicker.errors.typeRequired', 'Select an object type.'))
      return
    }

    if (!selectedRecord) {
      setRecordError(t('messages.composer.objectPicker.errors.recordRequired', 'Select a record.'))
      return
    }

    if (existingObjects.length >= maxObjects) {
      setGlobalError(
        t(
          'messages.composer.objectPicker.errors.maxObjects',
          'You can attach up to {count} objects.',
          { count: maxObjects },
        ),
      )
      return
    }

    const duplicate = existingObjects.some((item) =>
      normalizeObjectKey(item) ===
      normalizeObjectKey({
        entityModule: selectedType.module,
        entityType: selectedType.entityType,
        entityId: selectedRecord.id,
      }),
    )

    if (duplicate) {
      setGlobalError(t('messages.composer.objectPicker.errors.duplicate', 'This object is already attached.'))
      return
    }

    const selectedAction = sortedActions.find((action) => action.id === actionType)
    if (actionRequired && sortedActions.length > 0 && !selectedAction) {
      setActionTypeError(t('messages.composer.objectPicker.errors.actionRequired', 'Select an action.'))
      return
    }

    onConfirm({
      entityModule: selectedType.module,
      entityType: selectedType.entityType,
      entityId: selectedRecord.id,
      actionRequired,
      actionType: selectedAction?.id,
      actionLabel: selectedAction ? t(selectedAction.labelKey, selectedAction.id) : undefined,
    })

    onOpenChange(false)
  }, [
    actionRequired,
    actionType,
    existingObjects,
    maxObjects,
    messageType,
    onConfirm,
    onOpenChange,
    selectedRecord,
    selectedType,
    sortedActions,
    t,
  ])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleConfirm()
    }
  }, [handleCancel, handleConfirm])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('messages.composer.objectPicker.title', 'Attach object')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t(
              'messages.composer.objectPicker.messageTypeHint',
              'Only object types compatible with the selected message type are available.',
            )}
          </p>

          <div className="space-y-2">
            <Label htmlFor="messages-object-type-search">
              {t('messages.composer.objectPicker.searchLabel', 'Search object types')}
            </Label>
            <Input
              id="messages-object-type-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('messages.composer.objectPicker.searchPlaceholder', 'Type module or entity name')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="messages-object-type-select">
              {t('messages.composer.objectPicker.typeLabel', 'Object type')}
            </Label>
            <select
              id="messages-object-type-select"
              value={selectedTypeKey}
              onChange={(event) => {
                setSelectedTypeKey(event.target.value)
                setRecordSearch('')
                setSelectedRecordId('')
                setActionType('')
                setTypeError(null)
                setRecordError(null)
                setGlobalError(null)
              }}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">
                {t('messages.composer.objectPicker.typePlaceholder', 'Select object type')}
              </option>
              {filteredObjectTypes.map((item) => {
                const key = `${item.module}:${item.entityType}`
                return (
                  <option key={key} value={key}>
                    {t(item.labelKey, `${item.module}:${item.entityType}`)}
                  </option>
                )
              })}
            </select>
            {typeError ? <p className="text-xs text-destructive">{typeError}</p> : null}
          </div>

          {selectedType ? (
            <MessageObjectRecordPicker
              search={recordSearch}
              onSearchChange={(value) => {
                setRecordSearch(value)
                setRecordError(null)
                setGlobalError(null)
              }}
              selectedId={selectedRecordId}
              onSelectedIdChange={(value) => {
                setSelectedRecordId(value)
                setRecordError(null)
                setGlobalError(null)
              }}
              items={objectOptions}
              isLoading={objectOptionsQuery.isLoading}
              error={objectOptionsQuery.error instanceof Error ? objectOptionsQuery.error.message : null}
              onRetry={() => void objectOptionsQuery.refetch()}
            />
          ) : null}

          {recordError ? <p className="text-xs text-destructive">{recordError}</p> : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded border px-3 py-2">
              <div>
                <p className="text-sm font-medium">
                  {t('messages.composer.objectPicker.actionRequiredLabel', 'Action required')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'messages.composer.objectPicker.actionRequiredHint',
                    'Mark this object as requiring recipient action.',
                  )}
                </p>
              </div>
              <Switch checked={actionRequired} onCheckedChange={setActionRequired} />
            </div>

            {actionRequired && sortedActions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="messages-object-action-type">
                  {t('messages.composer.objectPicker.actionTypeLabel', 'Action type')}
                </Label>
                <select
                  id="messages-object-action-type"
                  value={actionType}
                  onChange={(event) => {
                    setActionType(event.target.value)
                    setActionTypeError(null)
                    setGlobalError(null)
                  }}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">
                    {t('messages.composer.objectPicker.actionTypePlaceholder', 'Select action')}
                  </option>
                  {sortedActions.map((action) => (
                    <option key={action.id} value={action.id}>
                      {t(action.labelKey, action.id)}
                    </option>
                  ))}
                </select>
                {actionTypeError ? <p className="text-xs text-destructive">{actionTypeError}</p> : null}
              </div>
            ) : null}
          </div>

          {existingObjects.length >= maxObjects ? (
            <p className="text-xs text-amber-700">
              {t('messages.composer.objectPicker.maxWarning', 'You reached the recommended limit of {count} objects.', { count: maxObjects })}
            </p>
          ) : null}

          {globalError ? <p className="text-xs text-destructive">{globalError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm}>
            {t('messages.composer.objectPicker.confirm', 'Attach')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
