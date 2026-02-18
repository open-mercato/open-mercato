"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPickerQueryState, ObjectPickerRecord } from '@open-mercato/shared/modules/messages/types'
import { resolveMessageObjectPickerComponent } from '@open-mercato/core/modules/messages/components/typeUiRegistry'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Switch } from '../../primitives/switch'

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

function normalizeObjectKey(item: Pick<MessageObjectInput, 'entityModule' | 'entityType' | 'entityId'>): string {
  return `${item.entityModule}:${item.entityType}:${item.entityId}`.toLowerCase()
}

const defaultQueryState: ObjectPickerQueryState = {
  search: '',
  page: 1,
  pageSize: 20,
  filters: {},
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
  const [selectedRecord, setSelectedRecord] = React.useState<ObjectPickerRecord | null>(null)
  const [pickerQueryState, setPickerQueryState] = React.useState<ObjectPickerQueryState>(defaultQueryState)
  const [manualEntityModule, setManualEntityModule] = React.useState('')
  const [manualEntityType, setManualEntityType] = React.useState('')
  const [manualEntityId, setManualEntityId] = React.useState('')
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
    setSelectedRecord(null)
    setPickerQueryState(defaultQueryState)
    setManualEntityModule('')
    setManualEntityType('')
    setManualEntityId('')
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
  const PickerComponent = resolveMessageObjectPickerComponent(selectedType?.module, selectedType?.entityType)
  const hasDedicatedPicker = Boolean(PickerComponent)

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

    const resolvedEntityModule = hasDedicatedPicker
      ? selectedType.module
      : (manualEntityModule.trim() || selectedType.module)
    const resolvedEntityType = hasDedicatedPicker
      ? selectedType.entityType
      : (manualEntityType.trim() || selectedType.entityType)
    const resolvedEntityId = hasDedicatedPicker
      ? (selectedRecord?.id ?? '')
      : manualEntityId.trim()

    if (!resolvedEntityId) {
      setRecordError(
        hasDedicatedPicker
          ? t('messages.composer.objectPicker.errors.recordRequired', 'Select a record.')
          : t('messages.composer.objectPicker.errors.entityIdRequired', 'Provide an entity id.'),
      )
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
        entityModule: resolvedEntityModule,
        entityType: resolvedEntityType,
        entityId: resolvedEntityId,
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
      entityModule: resolvedEntityModule,
      entityType: resolvedEntityType,
      entityId: resolvedEntityId,
      actionRequired,
      actionType: selectedAction?.id,
      actionLabel: selectedAction ? t(selectedAction.labelKey, selectedAction.id) : undefined,
    })

    onOpenChange(false)
  }, [
    actionRequired,
    actionType,
    existingObjects,
    hasDedicatedPicker,
    manualEntityId,
    manualEntityModule,
    manualEntityType,
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
                const nextTypeKey = event.target.value
                const nextType = objectTypes.find((item) => `${item.module}:${item.entityType}` === nextTypeKey) ?? null
                setSelectedTypeKey(event.target.value)
                setSelectedRecord(null)
                setPickerQueryState(defaultQueryState)
                setManualEntityModule(nextType?.module ?? '')
                setManualEntityType(nextType?.entityType ?? '')
                setManualEntityId('')
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
            hasDedicatedPicker && PickerComponent ? (
              <PickerComponent
                messageType={messageType}
                objectType={{
                  module: selectedType.module,
                  entityType: selectedType.entityType,
                  labelKey: selectedType.labelKey,
                  icon: selectedType.icon,
                }}
                selectedObjects={existingObjects.map((item) => ({
                  entityModule: item.entityModule,
                  entityType: item.entityType,
                  entityId: item.entityId,
                }))}
                selectedRecord={selectedRecord}
                onSelectRecord={(record) => {
                  setSelectedRecord(record)
                  setRecordError(null)
                  setGlobalError(null)
                }}
                queryState={pickerQueryState}
                onQueryStateChange={(next) => setPickerQueryState(next)}
              />
            ) : (
              <div className="space-y-3 rounded-md border border-dashed p-3">
                <p className="text-xs text-muted-foreground">
                  {t(
                    'messages.composer.objectPicker.manualFallbackHint',
                    'No domain picker is registered for this object type. Provide entity reference manually.',
                  )}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="messages-object-manual-module">
                    {t('messages.composer.objectPicker.entityModuleLabel', 'Entity module')}
                  </Label>
                  <Input
                    id="messages-object-manual-module"
                    value={manualEntityModule}
                    onChange={(event) => {
                      setManualEntityModule(event.target.value)
                      setRecordError(null)
                      setGlobalError(null)
                    }}
                    placeholder={t('messages.composer.objectPicker.entityModulePlaceholder', 'e.g. staff')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="messages-object-manual-type">
                    {t('messages.composer.objectPicker.entityTypeLabel', 'Entity type')}
                  </Label>
                  <Input
                    id="messages-object-manual-type"
                    value={manualEntityType}
                    onChange={(event) => {
                      setManualEntityType(event.target.value)
                      setRecordError(null)
                      setGlobalError(null)
                    }}
                    placeholder={t('messages.composer.objectPicker.entityTypePlaceholder', 'e.g. leave_request')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="messages-object-manual-id">
                    {t('messages.composer.objectPicker.entityIdLabel', 'Entity id')}
                  </Label>
                  <Input
                    id="messages-object-manual-id"
                    value={manualEntityId}
                    onChange={(event) => {
                      setManualEntityId(event.target.value)
                      setRecordError(null)
                      setGlobalError(null)
                    }}
                    placeholder={t('messages.composer.objectPicker.entityIdPlaceholder', 'Enter entity id')}
                  />
                </div>
              </div>
            )
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
