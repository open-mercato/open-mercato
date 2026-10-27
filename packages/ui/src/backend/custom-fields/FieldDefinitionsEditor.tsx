"use client"

import * as React from 'react'
import { Cog, GripVertical, Languages, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { CheckboxField } from '../../primitives/checkbox-field'
import { FormField } from '../../primitives/form-field'
import { IconButton } from '../../primitives/icon-button'
import { Input } from '../../primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/entities/kinds'
import { useOptionalT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { FieldRegistry } from '../fields/registry'
import { slugify } from '@open-mercato/shared/lib/slugify'
import { useConfirmDialog } from '../confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../primitives/dialog'
import {
  normalizeCustomFieldOptions,
  type CustomFieldOptionDto,
} from '@open-mercato/shared/modules/entities/options'

type FieldsetGroup = { code: string; title?: string; hint?: string }
type FieldsetConfig = { code: string; label: string; icon?: string; description?: string; groups?: FieldsetGroup[] }

function formatFallback(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey
    if (!key) return match
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}

export type FieldDefinition = {
  key: string
  kind: string
  configJson?: Record<string, unknown>
  isActive?: boolean
}

export type FieldDefinitionError = { key?: string; kind?: string }

export type FieldDefinitionsEditorProps = {
  definitions: FieldDefinition[]
  errors?: Record<number, FieldDefinitionError>
  deletedKeys?: string[]
  kindOptions?: Array<{ value: string; label: string }>
  orderNotice?: { dirty: boolean; saving?: boolean; message?: string }
  infoNote?: React.ReactNode
  addButtonLabel?: string
  fieldsets?: FieldsetConfig[]
  activeFieldset?: string | null
  onActiveFieldsetChange?: (code: string | null) => void
  onFieldsetsChange?: (next: FieldsetConfig[]) => void
  onFieldsetCodeChange?: (previousCode: string, nextCode: string) => void
  onFieldsetRemoved?: (code: string) => void
  onAddField: () => void
  onRemoveField: (index: number) => void
  onDefinitionChange: (index: number, next: FieldDefinition) => void
  onRestoreField?: (key: string) => void
  onReorder?: (from: number, to: number) => void
  onTranslate?: (definition: FieldDefinition, index: number) => void
  listRef?: React.Ref<HTMLDivElement>
  listProps?: React.HTMLAttributes<HTMLDivElement>
  singleFieldsetPerRecord?: boolean
  onSingleFieldsetPerRecordChange?: (value: boolean) => void
  translate?: TranslateFn
}

const DEFAULT_VALUE_NONE = '__open_mercato_no_default__'

function getDefaultValueNoneOptionValue(options: CustomFieldOptionDto[]): string {
  const optionValues = new Set(options.map((option) => String(option.value)))
  let candidate = DEFAULT_VALUE_NONE
  while (optionValues.has(candidate)) {
    candidate = `${candidate}_`
  }
  return candidate
}

const FIELDSET_ICON_OPTIONS = [
  { value: 'layers', label: 'Layers' },
  { value: 'tag', label: 'Tag' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'package', label: 'Package' },
  { value: 'shirt', label: 'Shirt' },
  { value: 'grid', label: 'Grid' },
  { value: 'shoppingBag', label: 'Shopping bag' },
  { value: 'shoppingCart', label: 'Shopping cart' },
  { value: 'store', label: 'Store' },
  { value: 'users', label: 'Users' },
  { value: 'briefcase', label: 'Briefcase' },
  { value: 'building', label: 'Building' },
  { value: 'bookOpen', label: 'Book open' },
  { value: 'bookmark', label: 'Bookmark' },
  { value: 'camera', label: 'Camera' },
  { value: 'car', label: 'Car' },
  { value: 'clock', label: 'Clock' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'compass', label: 'Compass' },
  { value: 'creditCard', label: 'Credit card' },
  { value: 'database', label: 'Database' },
  { value: 'flame', label: 'Flame' },
  { value: 'gift', label: 'Gift' },
  { value: 'globe', label: 'Globe' },
  { value: 'heart', label: 'Heart' },
  { value: 'key', label: 'Key' },
  { value: 'map', label: 'Map' },
  { value: 'palette', label: 'Palette' },
  { value: 'shield', label: 'Shield' },
  { value: 'star', label: 'Star' },
  { value: 'truck', label: 'Truck' },
  { value: 'zap', label: 'Zap' },
  { value: 'coins', label: 'Coins' },
]

function slugifyFieldsetCode(value: string): string {
  return slugify(value, { replacement: '', allowedChars: '_-' })
}

function ensureUniqueFieldsetCode(base: string, existing: FieldsetConfig[]): string {
  const sanitizedBase = slugifyFieldsetCode(base) || 'fieldset'
  let candidate = sanitizedBase
  let counter = 1
  const existingCodes = new Set(existing.map((fs) => fs.code))
  while (existingCodes.has(candidate)) {
    counter += 1
    candidate = `${sanitizedBase}_${counter}`
  }
  return candidate
}

function normalizeGroupValue(raw: unknown): FieldsetGroup | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const code = raw.trim()
    return code ? { code } : null
  }
  if (typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const code = typeof entry.code === 'string' ? entry.code.trim() : ''
  if (!code) return null
  const group: FieldsetGroup = { code }
  if (typeof entry.title === 'string' && entry.title.trim()) group.title = entry.title.trim()
  if (typeof entry.hint === 'string' && entry.hint.trim()) group.hint = entry.hint.trim()
  return group
}

export function FieldDefinitionsEditor({
  definitions,
  errors,
  deletedKeys,
  kindOptions,
  orderNotice,
  infoNote,
  addButtonLabel,
  fieldsets = [],
  activeFieldset = null,
  onActiveFieldsetChange,
  onFieldsetsChange,
  onFieldsetCodeChange,
  onFieldsetRemoved,
  singleFieldsetPerRecord,
  onSingleFieldsetPerRecordChange,
  onAddField,
  onRemoveField,
  onDefinitionChange,
  onRestoreField,
  onReorder,
  onTranslate,
  listRef,
  listProps,
  translate,
}: FieldDefinitionsEditorProps) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const dragIndex = React.useRef<number | null>(null)
  const hasFieldsets = fieldsets.length > 0
  const contextT = useOptionalT()
  const t = React.useCallback<TranslateFn>(
    (key, fallbackOrParams, params) => {
      if (translate) return translate(key, fallbackOrParams, params)
      if (contextT) return contextT(key, fallbackOrParams, params)
      return typeof fallbackOrParams === 'string'
        ? formatFallback(fallbackOrParams, params)
        : key
    },
    [translate, contextT],
  )
  const resolvedKindOptions = React.useMemo(
    () =>
      kindOptions ??
      CUSTOM_FIELD_KINDS.map((kind) => ({
        value: kind,
        label: t(`entities.customFields.editor.kindOption.${kind}`, kind.charAt(0).toUpperCase() + kind.slice(1)),
      })),
    [kindOptions, t],
  )
  const resolvedInfoNote = infoNote !== undefined ? infoNote : (
    <div className="text-xs text-muted-foreground mt-2">
      {t(
        'entities.customFields.editor.supportedKindsNote',
        'Supported kinds: text, multiline, integer, float, boolean, select (with options/optionsUrl), currency (fixed currencies list), relation (with related entity and options URL).',
      )}
    </div>
  )
  const resolvedAddButtonLabel = addButtonLabel ?? t('entities.customFields.editor.addField', 'Add Field')
  const resolvedActiveFieldset = React.useMemo(() => {
    if (!hasFieldsets) return activeFieldset ?? null
    if (activeFieldset === null) return null
    return fieldsets.some((fs) => fs.code === activeFieldset) ? activeFieldset : (fieldsets[0]?.code ?? null)
  }, [activeFieldset, fieldsets, hasFieldsets])

  const filteredDefinitions = React.useMemo(
    () =>
      definitions
        .map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => {
          if (!hasFieldsets) return true
          const assigned = typeof definition.configJson?.fieldset === 'string' ? definition.configJson.fieldset : undefined
          if (!resolvedActiveFieldset) return !assigned
          return assigned === resolvedActiveFieldset
        }),
    [definitions, hasFieldsets, resolvedActiveFieldset],
  )

  const activeFieldsetConfig = hasFieldsets && resolvedActiveFieldset
    ? fieldsets.find((fs) => fs.code === resolvedActiveFieldset) ?? null
    : null

  const handleActiveFieldsetChange = (value: string) => {
    if (!onActiveFieldsetChange) return
    onActiveFieldsetChange(value ? value : null)
  }

  const handleFieldsetPatch = (code: string, patch: Partial<FieldsetConfig>) => {
    if (!onFieldsetsChange) return
    const next = fieldsets.map((fs) => (fs.code === code ? { ...fs, ...patch } : fs))
    onFieldsetsChange(next)
  }

  const handleFieldsetCodeInput = (code: string, nextValue: string) => {
    if (!onFieldsetsChange) return
    const target = fieldsets.find((fs) => fs.code === code)
    if (!target) return
    const sanitized = slugifyFieldsetCode(nextValue)
    if (!sanitized) return
    const next = fieldsets.map((fs) => (fs.code === code ? { ...fs, code: sanitized } : fs))
    onFieldsetsChange(next)
    onFieldsetCodeChange?.(code, sanitized)
    onActiveFieldsetChange?.(sanitized)
  }

  const handleAddFieldset = () => {
    if (!onFieldsetsChange) return
    const code = ensureUniqueFieldsetCode(`fieldset_${fieldsets.length + 1}`, fieldsets)
    const nextFieldsets = [...fieldsets, { code, label: t('entities.customFields.editor.newFieldsetLabel', 'New fieldset'), icon: 'layers' }]
    onFieldsetsChange(nextFieldsets)
    onActiveFieldsetChange?.(code)
  }

  const handleRemoveFieldset = async () => {
    if (!onFieldsetsChange) return
    if (!resolvedActiveFieldset) return
    const confirmed = await confirm({
      title: t('entities.customFields.editor.deleteFieldsetTitle', 'Delete fieldset "{code}"?', {
        code: resolvedActiveFieldset,
      }),
      text: t('entities.customFields.editor.deleteFieldsetText', 'This will move its fields to Unassigned.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const next = fieldsets.filter((fs) => fs.code !== resolvedActiveFieldset)
    onFieldsetsChange(next)
    onFieldsetRemoved?.(resolvedActiveFieldset)
    const fallback = next[0]?.code ?? null
    onActiveFieldsetChange?.(fallback)
  }

  const registerGroup = React.useCallback(
    (fieldsetCode: string, group: FieldsetGroup) => {
      if (!onFieldsetsChange || !fieldsetCode) return
      const next = fieldsets.map((fs) => {
        if (fs.code !== fieldsetCode) return fs
        const list = Array.isArray(fs.groups) ? fs.groups : []
        const existingIndex = list.findIndex((entry) => entry.code === group.code)
        if (existingIndex >= 0) {
          const updated = [...list]
          updated[existingIndex] = { ...list[existingIndex], ...group }
          return { ...fs, groups: updated }
        }
        return { ...fs, groups: [...list, group] }
      })
      onFieldsetsChange(next)
    },
    [fieldsets, onFieldsetsChange],
  )
  const removeGroup = React.useCallback(
    (fieldsetCode: string, groupCode: string) => {
      if (!onFieldsetsChange || !fieldsetCode || !groupCode) return
      const next = fieldsets.map((fs) => {
        if (fs.code !== fieldsetCode) return fs
        const list = Array.isArray(fs.groups) ? fs.groups : []
        return { ...fs, groups: list.filter((entry) => entry.code !== groupCode) }
      })
      onFieldsetsChange(next)
    },
    [fieldsets, onFieldsetsChange],
  )
  const availableGroups = activeFieldsetConfig?.groups ?? []
  const canToggleSingleFieldset = hasFieldsets && fieldsets.length > 1
  const singleFieldsetChecked = singleFieldsetPerRecord !== false

  const handleReorder = React.useCallback(
    (from: number, to: number) => {
      if (from === to) return
      onReorder?.(from, to)
    },
    [onReorder],
  )

  return (
    <div
      ref={listRef}
      className="space-y-3"
      {...listProps}
    >
      {hasFieldsets ? (
        <div className="rounded border bg-card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">{t('entities.customFields.fieldsetSelectorLabel', 'Fieldset')}</label>
            <Select
              value={resolvedActiveFieldset || undefined}
              onValueChange={(value) => handleActiveFieldsetChange(value ?? '')}
            >
              <SelectTrigger size="sm" className="w-auto min-w-[10rem]">
                <SelectValue placeholder={t('entities.customFields.editor.unassignedFields', 'Unassigned fields')} />
              </SelectTrigger>
              <SelectContent>
                {fieldsets.map((fs) => (
                  <SelectItem key={fs.code} value={fs.code}>
                    {fs.label || fs.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddFieldset}
              className="text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> {t('entities.customFields.editor.add', 'Add')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemoveFieldset}
              disabled={!resolvedActiveFieldset}
              className="text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t('entities.customFields.editor.delete', 'Delete')}
            </Button>
          </div>
          {resolvedActiveFieldset && activeFieldsetConfig ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <FormField label={t('entities.customFields.editor.code', 'Code')}>
                <Input
                  size="sm"
                  inputClassName="font-mono"
                  value={activeFieldsetConfig.code}
                  onChange={(event) => handleFieldsetCodeInput(activeFieldsetConfig.code, event.target.value)}
                />
              </FormField>
              <FormField label={t('entities.customFields.editor.label', 'Label')}>
                <Input
                  size="sm"
                  value={activeFieldsetConfig.label}
                  onChange={(event) => handleFieldsetPatch(activeFieldsetConfig.code, { label: event.target.value })}
                />
              </FormField>
              <FormField label={t('entities.customFields.editor.icon', 'Icon')}>
                <Select
                  value={activeFieldsetConfig.icon || undefined}
                  onValueChange={(value) =>
                    handleFieldsetPatch(activeFieldsetConfig.code, {
                      icon: value || undefined,
                    })
                  }
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder={t('entities.customFields.editor.defaultOption', 'Default')} />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELDSET_ICON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(`entities.customFields.editor.iconOption.${option.value}`, option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t('entities.customFields.editor.description', 'Description')}>
                <Input
                  size="sm"
                  value={activeFieldsetConfig.description ?? ''}
                  onChange={(event) => handleFieldsetPatch(activeFieldsetConfig.code, { description: event.target.value })}
                />
              </FormField>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <CheckboxField
              size="sm"
              disabled={!canToggleSingleFieldset}
              checked={singleFieldsetChecked}
              onCheckedChange={(checked) => onSingleFieldsetPerRecordChange?.(checked === true)}
              label={t('entities.customFields.editor.singleFieldsetPerEntity', 'Single fieldset per entity')}
              containerClassName="text-xs"
              contentClassName="gap-1 [&_label]:text-xs [&_label]:font-normal"
            />
            {!canToggleSingleFieldset ? (
              <span className="text-xs text-muted-foreground">{t('entities.customFields.editor.singleFieldsetToggleHint', '(add at least two fieldsets to toggle)')}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground flex flex-col gap-3">
          <div>{t('entities.customFields.editor.noFieldsets', 'No fieldsets defined yet. Fieldsets let you group custom fields for different variants of the same entity (e.g., Fashion vs. Sport products).')}</div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddFieldset}
            >
              <Plus className="h-4 w-4" />
              {t('entities.customFields.editor.addFirstFieldset', 'Add first fieldset')}
            </Button>
          </div>
        </div>
      )}
      {orderNotice?.dirty && (
        <div className="sticky top-0 z-sticky -mt-1 -mb-1">
          <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-status-warning-border bg-status-warning-bg text-status-warning-text shadow-sm">
            {orderNotice?.saving
              ? t('entities.customFields.editor.savingOrder', 'Saving order…')
              : (orderNotice?.message ?? t('entities.customFields.editor.reorderedSavingSoon', 'Reordered — saving soon'))}
          </div>
        </div>
      )}
      {filteredDefinitions.map(({ definition, index }) => {
        const assignedFieldset = typeof definition.configJson?.fieldset === 'string' ? definition.configJson.fieldset : null
        const groupOptions = assignedFieldset
          ? fieldsets.find((fs) => fs.code === assignedFieldset)?.groups ?? []
          : availableGroups
        return (
        <div
          key={definition.key || `def-${index}`}
          className="group"
          draggable
          onDragStart={() => { dragIndex.current = index }}
          onDragOver={(event) => { event.preventDefault() }}
          onDrop={() => {
            const from = dragIndex.current
            if (from == null) return
            dragIndex.current = null
            handleReorder(from, index)
          }}
          onDragEnd={() => { dragIndex.current = null }}
          tabIndex={0}
          onKeyDown={(event) => {
            if (!event.altKey) return
            if (event.key === 'ArrowUp' || event.key === 'Up') {
              event.preventDefault()
              handleReorder(index, Math.max(0, index - 1))
            }
            if (event.key === 'ArrowDown' || event.key === 'Down') {
              event.preventDefault()
              handleReorder(index, Math.min(definitions.length - 1, index + 1))
            }
          }}
        >
          <FieldDefinitionCard
            definition={definition}
            error={errors?.[index]}
            kindOptions={resolvedKindOptions}
            onChange={(next) => onDefinitionChange(index, next)}
            onRemove={() => onRemoveField(index)}
            allowFieldsetSelection={hasFieldsets}
            fieldsets={fieldsets}
            activeFieldset={resolvedActiveFieldset}
            availableGroups={groupOptions}
            onRegisterGroup={registerGroup}
            onRemoveGroup={removeGroup}
            onTranslate={onTranslate ? () => onTranslate(definition, index) : undefined}
            translate={t}
          />
        </div>
      )})}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={onAddField}
        >
          <Plus className="h-4 w-4" /> {resolvedAddButtonLabel}
        </Button>
        {resolvedInfoNote}
        {deletedKeys && deletedKeys.length > 0 && onRestoreField ? (
          <div className="text-xs text-muted-foreground mt-2">
            {t('entities.customFields.editor.restoreDeletedFields', 'Restore deleted fields:')}{' '}
            {deletedKeys.map((key, idx) => (
              <span key={key}>
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => onRestoreField(key)}
                >
                  {key}
                </Button>
                {idx < deletedKeys.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {ConfirmDialogElement}
    </div>
  )
}

type FieldDefinitionCardProps = {
  definition: FieldDefinition
  error?: FieldDefinitionError
  kindOptions: Array<{ value: string; label: string }>
  onChange: (next: FieldDefinition) => void
  onRemove: () => void
  allowFieldsetSelection?: boolean
  fieldsets?: FieldsetConfig[]
  activeFieldset?: string | null
  availableGroups?: FieldsetGroup[]
  onRegisterGroup?: (fieldsetCode: string, group: FieldsetGroup) => void
  onRemoveGroup?: (fieldsetCode: string, groupCode: string) => void
  onTranslate?: () => void
  translate?: TranslateFn
}

const FieldDefinitionCard = React.memo(function FieldDefinitionCard({
  definition,
  error,
  kindOptions,
  onChange,
  onRemove,
  allowFieldsetSelection = false,
  fieldsets = [],
  activeFieldset,
  availableGroups = [],
  onRegisterGroup,
  onRemoveGroup,
  onTranslate,
  translate,
}: FieldDefinitionCardProps) {
  const [local, setLocal] = React.useState<FieldDefinition>(definition)
  const localRef = React.useRef<FieldDefinition>(definition)
  const [optionValueDraft, setOptionValueDraft] = React.useState('')
  const [optionLabelDraft, setOptionLabelDraft] = React.useState('')
  const [optionDialogOpen, setOptionDialogOpen] = React.useState(false)
  const [optionFormError, setOptionFormError] = React.useState<string | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = React.useState(false)
  const [groupDraft, setGroupDraft] = React.useState({ code: '', title: '', hint: '' })
  const [editingGroupCode, setEditingGroupCode] = React.useState<string | null>(null)
  const [groupError, setGroupError] = React.useState<string | null>(null)
  const currentFieldsetValue = React.useMemo(
    () => (typeof local.configJson?.fieldset === 'string' ? local.configJson.fieldset : ''),
    [local.configJson?.fieldset],
  )
  const t = React.useCallback<TranslateFn>(
    (key, fallbackOrParams, params) => {
      if (translate) return translate(key, fallbackOrParams, params)
      return typeof fallbackOrParams === 'string'
        ? formatFallback(fallbackOrParams, params)
        : key
    },
    [translate],
  )
  React.useEffect(() => {
    localRef.current = definition
    setLocal(definition)
  }, [definition.key])
  React.useEffect(() => {
    setOptionValueDraft('')
    setOptionLabelDraft('')
    setGroupDialogOpen(false)
    setGroupDraft({ code: '', title: '', hint: '' })
    setEditingGroupCode(null)
    setGroupError(null)
  }, [definition.key])
  React.useEffect(() => {
    if (!currentFieldsetValue) {
      setGroupDialogOpen(false)
      setGroupDraft({ code: '', title: '', hint: '' })
      setEditingGroupCode(null)
      setGroupError(null)
    }
  }, [currentFieldsetValue])
  const currentGroup = React.useMemo(() => normalizeGroupValue(local.configJson?.group), [local])
  const groupOptions = React.useMemo(() => {
    const list = Array.isArray(availableGroups) ? [...availableGroups] : []
    if (currentGroup && !list.some((entry) => entry.code === currentGroup.code)) {
      list.push(currentGroup)
    }
    return list
  }, [availableGroups, currentGroup])
  const resolvedOptions = React.useMemo<CustomFieldOptionDto[]>(
    () => normalizeCustomFieldOptions(local.configJson?.options),
    [local.configJson?.options],
  )

  const sanitize = (def: FieldDefinition): FieldDefinition => {
    if (!def.configJson || !Array.isArray(def.configJson.options)) return def
    const normalizedOptions = normalizeCustomFieldOptions(def.configJson.options)
    return {
      ...def,
      configJson: {
        ...def.configJson,
        options: normalizedOptions,
      },
    }
  }

  const replaceLocal = React.useCallback((next: FieldDefinition) => {
    localRef.current = next
    setLocal(next)
    return next
  }, [])

  const apply = (patch: Partial<FieldDefinition> | ((current: FieldDefinition) => Partial<FieldDefinition>), propagateNow = false) => {
    const current = localRef.current
    const resolvedPatch = typeof patch === 'function' ? patch(current) : patch
    const next = { ...current, ...resolvedPatch }
    const resolvedNext = propagateNow ? sanitize(next) : next
    replaceLocal(resolvedNext)
    if (propagateNow) {
      onChange(resolvedNext)
    }
  }

  const commit = () => {
    const sanitized = sanitize(localRef.current)
    replaceLocal(sanitized)
    onChange(sanitized)
  }

  const handleFieldsetSelect = (value: string) => {
    const nextConfig = { ...(localRef.current.configJson || {}) }
    if (value) nextConfig.fieldset = value
    else delete nextConfig.fieldset
    delete nextConfig.group
    const next = { ...localRef.current, configJson: nextConfig }
    replaceLocal(next)
    onChange(next)
  }

  const handleGroupSelect = (value: string) => {
    if (!currentFieldsetValue) return
    if (!value) {
      const nextConfig = { ...(local.configJson || {}) }
      delete nextConfig.group
      apply({ configJson: nextConfig }, true)
      return
    }
    const match = groupOptions.find((group) => group.code === value)
    const nextGroup = match ?? { code: value }
    const nextConfig = { ...(local.configJson || {}) }
    nextConfig.group = nextGroup
    apply({ configJson: nextConfig }, true)
    onRegisterGroup?.(currentFieldsetValue, nextGroup)
  }

  const handleOpenGroupDialog = (group?: FieldsetGroup) => {
    if (!currentFieldsetValue) return
    if (group) {
      setGroupDraft({
        code: group.code,
        title: group.title ?? '',
        hint: group.hint ?? '',
      })
      setEditingGroupCode(group.code)
    } else {
      setGroupDraft({ code: '', title: '', hint: '' })
      setEditingGroupCode(null)
    }
    setGroupError(null)
    setGroupDialogOpen(true)
  }

  const handleGroupDialogSubmit = () => {
    if (!currentFieldsetValue) return
    const code = slugifyFieldsetCode(groupDraft.code || '')
    if (!code) {
      setGroupError(t('entities.customFields.editor.groupCodeRequired', 'Group code is required.'))
      return
    }
    const group: FieldsetGroup = {
      code,
      title: groupDraft.title.trim() || undefined,
      hint: groupDraft.hint.trim() || undefined,
    }
    onRegisterGroup?.(currentFieldsetValue, group)
    const shouldAttachToField = !editingGroupCode || currentGroup?.code === editingGroupCode
    if (shouldAttachToField) {
      const nextConfig = { ...(local.configJson || {}) }
      nextConfig.group = group
      apply({ configJson: nextConfig }, true)
    }
    setGroupDraft({ code: '', title: '', hint: '' })
    setEditingGroupCode(null)
    setGroupDialogOpen(false)
  }

  const handleRemoveGroupEntry = (code: string) => {
    if (!currentFieldsetValue) return
    onRemoveGroup?.(currentFieldsetValue, code)
    if (currentGroup?.code === code) {
      handleGroupSelect('')
    }
    if (editingGroupCode === code) {
      setGroupDraft({ code: '', title: '', hint: '' })
      setEditingGroupCode(null)
    }
  }

  const handleEditGroupEntry = (group: FieldsetGroup) => {
    handleOpenGroupDialog(group)
  }

  const resetOptionDialog = () => {
    setOptionValueDraft('')
    setOptionLabelDraft('')
    setOptionFormError(null)
  }

  const handleOpenOptionDialog = () => {
    resetOptionDialog()
    setOptionDialogOpen(true)
  }

  const handleCloseOptionDialog = () => {
    resetOptionDialog()
    setOptionDialogOpen(false)
  }

  const handleAddOption = () => {
    const value = optionValueDraft.trim()
    const label = optionLabelDraft.trim()
    if (!value) {
      setOptionFormError(t('entities.customFields.editor.valueRequired', 'Value is required'))
      return
    }
    setOptionFormError(null)
    const nextOptions = Array.isArray(local.configJson?.options) ? [...local.configJson!.options] : []
    nextOptions.push({ value, label: label || value })
    apply({ configJson: { ...(local.configJson || {}), options: nextOptions } }, true)
    handleCloseOptionDialog()
  }

  const handleRemoveOption = (index: number) => {
    const nextOptions = Array.isArray(local.configJson?.options) ? [...local.configJson!.options] : []
    nextOptions.splice(index, 1)
    apply({ configJson: { ...(local.configJson || {}), options: nextOptions } }, true)
  }

  return (
    <>
    <div className="rounded border p-3 bg-card transition-colors hover:border-muted-foreground/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted cursor-grab active:cursor-grabbing">
            <GripVertical className="h-4 w-4 opacity-70" />
          </span>
          {t('entities.customFields.editor.dragToReorder', 'Drag to reorder')}
        </div>
        <div className="flex items-center gap-3">
          <CheckboxField
            size="sm"
            checked={local.isActive !== false}
            onCheckedChange={(checked) => { apply({ isActive: checked === true }, true) }}
            label={t('entities.customFields.editor.active', 'Active')}
            containerClassName="text-sm"
            contentClassName="gap-1 [&_label]:text-sm [&_label]:font-normal"
          />
          {onTranslate && (
            <IconButton variant="outline" size="sm" onClick={onTranslate} aria-label={t('entities.customFields.editor.translateField', 'Translate field')}>
              <Languages className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton variant="outline" size="sm" onClick={onRemove} aria-label={t('entities.customFields.editor.removeField', 'Remove field')}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        <FormField label={t('entities.customFields.editor.key', 'Key')} error={error?.key} className="md:col-span-6">
          <Input
            inputClassName="font-mono"
            placeholder="snake_case"
            value={local.key}
            onChange={(event) => apply({ key: event.target.value })}
            onBlur={commit}
          />
        </FormField>
        <FormField label={t('entities.customFields.editor.kind', 'Kind')} error={error?.kind} className="md:col-span-6">
          <Select
            value={local.kind || undefined}
            onValueChange={(value) => { apply({ kind: value ?? '' }, true) }}
          >
            <SelectTrigger aria-invalid={!!error?.kind}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      {allowFieldsetSelection ? (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs">{t('entities.customFields.editor.assignToFieldset', 'Assign to fieldset')}</label>
            <Select
              value={currentFieldsetValue || undefined}
              onValueChange={(value) => handleFieldsetSelect(value ?? '')}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('entities.customFields.editor.unassigned', 'Unassigned')} />
              </SelectTrigger>
              <SelectContent>
                {(fieldsets || []).map((fs) => (
                  <SelectItem key={fs.code} value={fs.code}>
                    {fs.label || fs.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {currentFieldsetValue ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs">{t('entities.customFields.editor.group', 'Group')}</label>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Select
                  value={currentGroup?.code || undefined}
                  onValueChange={(value) => handleGroupSelect(value ?? '')}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t('entities.customFields.editor.noGroup', 'No group')} />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((group) => (
                      <SelectItem key={group.code} value={group.code}>
                        {group.title || group.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <IconButton
                  variant="outline"
                  className="text-muted-foreground"
                  onClick={() => handleOpenGroupDialog()}
                  aria-label={t('entities.customFields.editor.createGroup', 'Create group')}
                >
                  <Plus className="h-4 w-4" />
                </IconButton>
                <IconButton
                  variant="outline"
                  className="text-muted-foreground"
                  onClick={() => handleOpenGroupDialog()}
                  aria-label={t('entities.customFields.editor.editGroups', 'Edit groups')}
                >
                  <Cog className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <FormField label={t('entities.customFields.editor.label', 'Label')}>
          <Input
            value={typeof local.configJson?.label === 'string' ? local.configJson.label : ''}
            onChange={(event) => apply({ configJson: { ...(local.configJson || {}), label: event.target.value } })}
            onBlur={commit}
          />
        </FormField>
        <FormField label={t('entities.customFields.editor.description', 'Description')}>
          <Input
            value={typeof local.configJson?.description === 'string' ? local.configJson.description : ''}
            onChange={(event) => apply({ configJson: { ...(local.configJson || {}), description: event.target.value } })}
            onBlur={commit}
          />
        </FormField>

        {(local.kind === 'text' || local.kind === 'multiline') && (
          <>
            <div>
              <label className="text-xs">{t('entities.customFields.editor.editor', 'Editor')}</label>
              <Select
                value={typeof local.configJson?.editor === 'string' && local.configJson.editor ? local.configJson.editor : undefined}
                onValueChange={(value) => { apply({ configJson: { ...(local.configJson || {}), editor: value || undefined } }, true) }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('entities.customFields.editor.defaultOption', 'Default')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="markdown">{t('entities.customFields.editor.editorMarkdown', 'Markdown (UIW)')}</SelectItem>
                  <SelectItem value="simpleMarkdown">{t('entities.customFields.editor.editorSimpleMarkdown', 'Simple Markdown')}</SelectItem>
                  <SelectItem value="htmlRichText">{t('entities.customFields.editor.editorHtmlRichText', 'HTML Rich Text')}</SelectItem>
                  <SelectItem value="plain">{t('entities.customFields.editor.editorPlain', 'Plain textarea')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {local.kind === 'text' && (
              <>
                <CheckboxField
                  size="sm"
                  checked={!!local.configJson?.multi}
                  onCheckedChange={(checked) => { apply({ configJson: { ...(local.configJson || {}), multi: checked === true } }, true) }}
                  label={t('entities.customFields.editor.multiple', 'Multiple')}
                  containerClassName="md:col-span-2"
                  contentClassName="gap-1 [&_label]:text-xs [&_label]:font-normal"
                />
                {!!local.configJson?.multi && (
                  <div className="md:col-span-2">
                    <label className="text-xs">{t('entities.customFields.editor.multiSelectInputStyle', 'Multi-select input style')}</label>
                    <Select
                      value={local.configJson?.input === 'listbox' ? 'listbox' : 'default'}
                      onValueChange={(value) => {
                        const nextConfig = { ...(local.configJson || {}) }
                        if (value === 'listbox') nextConfig.input = 'listbox'
                        else delete nextConfig.input
                        apply({ configJson: nextConfig }, true)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{t('entities.customFields.editor.defaultOption', 'Default')}</SelectItem>
                        <SelectItem value="listbox">{t('entities.customFields.editor.listboxSearchable', 'Listbox (searchable)')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {local.kind === 'select' && (
          <div className="md:col-span-6 space-y-3">
            <label className="text-xs">{t('entities.customFields.editor.options', 'Options')}</label>
            <div className="space-y-2">
              {resolvedOptions.length > 0 ? (
                resolvedOptions.map((option, idx) => (
                  <div
                    key={`${option.value}-${idx}`}
                    className="flex items-center justify-between rounded border px-3 py-2 text-xs bg-muted"
                  >
                    <div>
                      <div className="font-medium text-foreground">{option.label}</div>
                      <div className="text-muted-foreground font-mono text-overline">{option.value}</div>
                    </div>
                    <IconButton
                      variant="ghost"
                      size="xs"
                      className="text-destructive hover:text-destructive/80"
                      onClick={() => handleRemoveOption(idx)}
                      aria-label={t('entities.customFields.editor.removeOption', 'Remove option')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">{t('entities.customFields.editor.noOptionsDefined', 'No options defined.')}</span>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleOpenOptionDialog}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('entities.customFields.editor.addOption', 'Add option')}
              </Button>
            </div>
          </div>
        )}

        {(local.kind === 'select' || local.kind === 'relation') && (
          <>
            <FormField label={t('entities.customFields.editor.optionsUrl', 'Options URL')}>
              <Input
                placeholder="/api/..."
                value={typeof local.configJson?.optionsUrl === 'string' ? local.configJson.optionsUrl : ''}
                onChange={(event) => apply({ configJson: { ...(local.configJson || {}), optionsUrl: event.target.value } })}
                onBlur={commit}
              />
            </FormField>
            {local.kind === 'relation' && (
              <FormField label={t('entities.customFields.editor.relatedEntityId', 'Related Entity ID')}>
                <Input
                  inputClassName="font-mono"
                  placeholder="module:entity"
                  value={typeof local.configJson?.relatedEntityId === 'string' ? local.configJson.relatedEntityId : ''}
                  onChange={(event) => {
                    const relatedEntityId = event.target.value
                    const defOptionsUrl = relatedEntityId
                      ? `/api/entities/relations/options?entityId=${encodeURIComponent(relatedEntityId)}`
                      : ''
                    apply({
                      configJson: {
                        ...(local.configJson || {}),
                        relatedEntityId,
                        optionsUrl: local.configJson?.optionsUrl || defOptionsUrl,
                      },
                    })
                  }}
                  onBlur={commit}
                />
              </FormField>
            )}
          </>
        )}

        {local.kind === 'currency' && (
          <div className="md:col-span-2">
            <label className="text-xs">{t('entities.customFields.editor.optionsSource', 'Options source')}</label>
            <div className="rounded border bg-muted px-2 py-1 text-xs text-muted-foreground">
              /api/currencies/options
            </div>
          </div>
        )}

        {(local.kind === 'integer' || local.kind === 'float') && (
          <FormField label={t('entities.customFields.editor.unitsOptional', 'Units (optional)')} className="md:col-span-2">
            <Input
              placeholder={t('entities.customFields.editor.unitsPlaceholder', 'kg, cm, etc.')}
              value={typeof local.configJson?.unit === 'string' ? local.configJson.unit : ''}
              onChange={(event) => apply({ configJson: { ...(local.configJson || {}), unit: event.target.value } })}
              onBlur={commit}
            />
          </FormField>
        )}
      </div>

      <div className="mt-3 pt-3 border-t">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">{t('entities.customFields.editor.validationRules', 'Validation rules')}</label>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => {
              apply((current) => {
                const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                list.push({ rule: 'required', message: t('entities.customFields.editor.ruleRequiredMessage', 'This field is required') } as any)
                return { configJson: { ...(current.configJson || {}), validation: list } }
              }, true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('entities.customFields.editor.addRule', 'Add rule')}
          </Button>
        </div>
        <div className="space-y-2">
          {(Array.isArray(local.configJson?.validation) ? local.configJson!.validation : []).map((rule: any, index: number) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <div className="md:col-span-3">
                <Select
                  value={rule?.rule || 'required'}
                  onValueChange={(value) => {
                    const nextRule = value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[index] as any) || {}
                      list[index] = { ...existing, rule: nextRule, message: existing.message || rule?.message || '' }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    }, true)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">{t('entities.customFields.editor.validation.required', 'required')}</SelectItem>
                    <SelectItem value="date">{t('entities.customFields.editor.validation.date', 'date')}</SelectItem>
                    <SelectItem value="integer">{t('entities.customFields.editor.validation.integer', 'integer')}</SelectItem>
                    <SelectItem value="float">{t('entities.customFields.editor.validation.float', 'float')}</SelectItem>
                    <SelectItem value="lt">{t('entities.customFields.editor.validation.lt', 'lt')}</SelectItem>
                    <SelectItem value="lte">{t('entities.customFields.editor.validation.lte', 'lte')}</SelectItem>
                    <SelectItem value="gt">{t('entities.customFields.editor.validation.gt', 'gt')}</SelectItem>
                    <SelectItem value="gte">{t('entities.customFields.editor.validation.gte', 'gte')}</SelectItem>
                    <SelectItem value="eq">{t('entities.customFields.editor.validation.eq', 'eq')}</SelectItem>
                    <SelectItem value="ne">{t('entities.customFields.editor.validation.ne', 'ne')}</SelectItem>
                    <SelectItem value="regex">{t('entities.customFields.editor.validation.regex', 'regex')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4">
                <Input
                  placeholder={
                    rule?.rule === 'regex'
                      ? t('entities.customFields.editor.rulePatternPlaceholder', 'Pattern (e.g. ^[a-z]+$)')
                      : (['lt','lte','gt','gte'].includes(rule?.rule)
                        ? t('entities.customFields.editor.ruleNumberPlaceholder', 'Number')
                        : t('entities.customFields.editor.noParameterPlaceholder', '—'))
                  }
                  value={rule?.param ?? ''}
                  onChange={(event) => {
                    const value = ['lt','lte','gt','gte'].includes(rule?.rule) ? Number(event.target.value) : event.target.value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[index] as any) || {}
                      list[index] = { ...existing, ...rule, param: value }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    })
                  }}
                  onBlur={commit}
                  disabled={rule?.rule === 'required' || rule?.rule === 'date' || rule?.rule === 'integer' || rule?.rule === 'float'}
                />
              </div>
              <div className="md:col-span-4">
                <Input
                  placeholder={t('entities.customFields.editor.ruleErrorMessagePlaceholder', 'Error message')}
                  value={rule?.message || ''}
                  onChange={(event) => {
                    const message = event.target.value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[index] as any) || {}
                      list[index] = { ...existing, ...rule, message }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    })
                  }}
                  onBlur={commit}
                />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <IconButton
                  variant="outline"
                  size="sm"
                  aria-label={t('entities.customFields.editor.removeRule', 'Remove rule')}
                  onClick={() => {
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      list.splice(index, 1)
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    }, true)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          ))}
          {(!Array.isArray(local.configJson?.validation) || local.configJson!.validation.length === 0) && (
            <div className="text-xs text-muted-foreground">{t('entities.customFields.editor.noValidationRules', 'No validation rules defined.')}</div>
          )}
        </div>
      </div>

      <div className="mt-3">
        {(() => {
          const Editor = FieldRegistry.getDefEditor(local.kind)
          if (!Editor) return null
          return (
            <Editor
              def={{ key: local.key, kind: local.kind, configJson: local.configJson }}
              onChange={(patch) => apply({ configJson: { ...(local.configJson || {}), ...(patch || {}) } }, true)}
            />
          )
        })()}
      </div>

      {/* Default value control — shown for kinds without a dedicated FieldRegistry defEditor default section */}
      {(() => {
        // Dictionary kind handles defaults in its own defEditor; skip here
        if (local.kind === 'dictionary') return null
        // Relation and attachment kinds do not support defaults
        if (local.kind === 'relation' || local.kind === 'attachment') return null
        const currentDefault = local.configJson?.defaultValue
        if (local.kind === 'boolean') {
          const boolDefault = currentDefault === true ? 'true' : currentDefault === false ? 'false' : ''
          return (
            <FormField label={t('entities.customFields.fields.defaultValue', 'Default value')} className="mt-3">
              <Select
                value={boolDefault || DEFAULT_VALUE_NONE}
                onValueChange={(raw) => {
                  const value = raw === 'true' ? true : raw === 'false' ? false : undefined
                  apply({ configJson: { ...(local.configJson || {}), defaultValue: value } }, true)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_VALUE_NONE}>{t('entities.customFields.fields.defaultValueNone', 'No default')}</SelectItem>
                  <SelectItem value="true">{t('entities.customFields.fields.defaultValueTrue', 'Checked (true)')}</SelectItem>
                  <SelectItem value="false">{t('entities.customFields.fields.defaultValueFalse', 'Unchecked (false)')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )
        }
        // select with static options — picker
        if (local.kind === 'select' && !local.configJson?.multi) {
          const opts = normalizeCustomFieldOptions(local.configJson?.options || [])
          if (opts.length > 0) {
            const noneValue = getDefaultValueNoneOptionValue(opts)
            return (
              <FormField label={t('entities.customFields.fields.defaultValue', 'Default value')} className="mt-3">
                <Select
                  value={typeof currentDefault === 'string' || typeof currentDefault === 'number' ? String(currentDefault) : ''}
                  onValueChange={(raw) => {
                    if (raw === noneValue) {
                      apply({ configJson: { ...(local.configJson || {}), defaultValue: undefined } }, true)
                      return
                    }
                    // Preserve the original option type (string or number) instead of coercing to string
                    const matched = opts.find((o) => String(o.value) === raw)
                    const typed = matched ? matched.value : raw
                    apply({ configJson: { ...(local.configJson || {}), defaultValue: typed } }, true)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('entities.customFields.fields.defaultValueNone', 'No default')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={noneValue}>{t('entities.customFields.fields.defaultValueNone', 'No default')}</SelectItem>
                    {opts.map((option) => (
                      <SelectItem key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )
          }
        }
        // Numeric kinds
        if (local.kind === 'integer' || local.kind === 'float') {
          return (
            <FormField label={t('entities.customFields.fields.defaultValue', 'Default value')} className="mt-3">
              <Input
                type="number"
                step={local.kind === 'integer' ? '1' : 'any'}
                value={typeof currentDefault === 'number' ? String(currentDefault) : ''}
                onChange={(event) => {
                  const raw = event.target.value
                  const parsed = raw === '' ? undefined : (local.kind === 'integer' ? parseInt(raw, 10) : parseFloat(raw))
                  const value = parsed !== undefined && !isNaN(parsed) ? parsed : undefined
                  apply({ configJson: { ...(local.configJson || {}), defaultValue: value } })
                }}
                onBlur={commit}
                placeholder={t('entities.customFields.fields.defaultValuePlaceholder', 'No default')}
              />
            </FormField>
          )
        }
        // Text-like kinds (text, multiline, date, datetime, currency)
        if (['text', 'multiline', 'date', 'datetime', 'currency'].includes(local.kind)) {
          return (
            <FormField label={t('entities.customFields.fields.defaultValue', 'Default value')} className="mt-3">
              <Input
                value={typeof currentDefault === 'string' ? currentDefault : ''}
                onChange={(event) => {
                  const value = event.target.value
                  apply({ configJson: { ...(local.configJson || {}), defaultValue: value || undefined } })
                }}
                onBlur={commit}
                placeholder={t('entities.customFields.fields.defaultValuePlaceholder', 'No default')}
              />
            </FormField>
          )
        }
        return null
      })()}

      <div className="mt-3 pt-2 border-t flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted-foreground">{t('entities.customFields.fields.visibility', 'Visibility:')}</span>
        <CheckboxField
          size="sm"
          checked={local.configJson?.listVisible !== false}
          onCheckedChange={(checked) => { apply({ configJson: { ...(local.configJson || {}), listVisible: checked === true } }, true) }}
          label={t('entities.customFields.fields.listVisible', 'List')}
          contentClassName="gap-1 [&_label]:text-xs [&_label]:font-normal"
        />
        <CheckboxField
          size="sm"
          checked={!!local.configJson?.filterable}
          onCheckedChange={(checked) => { apply({ configJson: { ...(local.configJson || {}), filterable: checked === true } }, true) }}
          label={t('entities.customFields.fields.filterable', 'Filter')}
          contentClassName="gap-1 [&_label]:text-xs [&_label]:font-normal"
        />
        <CheckboxField
          size="sm"
          checked={local.configJson?.formEditable !== false}
          onCheckedChange={(checked) => { apply({ configJson: { ...(local.configJson || {}), formEditable: checked === true } }, true) }}
          label={t('entities.customFields.fields.formEditable', 'Form')}
          contentClassName="gap-1 [&_label]:text-xs [&_label]:font-normal"
        />
        <CheckboxField
          size="sm"
          checked={!!local.configJson?.encrypted}
          onCheckedChange={(checked) => { apply({ configJson: { ...(local.configJson || {}), encrypted: checked === true } }, true) }}
          label={t('entities.customFields.fields.encrypted', 'Encrypted')}
          contentClassName="gap-1 [&_label]:text-xs [&_label]:font-normal"
        />
      </div>
    </div>
    <Dialog
      open={optionDialogOpen}
      onOpenChange={(open) => {
        setOptionDialogOpen(open)
        if (!open) resetOptionDialog()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('entities.customFields.editor.addOption', 'Add option')}</DialogTitle>
          <DialogDescription>{t('entities.customFields.editor.addOptionDescription', 'Provide the stored value and optional label shown to users.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormField label={t('entities.customFields.editor.value', 'Value')} error={optionFormError ?? undefined}>
            <Input
              inputClassName="font-mono"
              placeholder="unique_value"
              value={optionValueDraft}
              onChange={(event) => {
                setOptionFormError(null)
                setOptionValueDraft(event.target.value)
              }}
            />
          </FormField>
          <FormField label={t('entities.customFields.editor.label', 'Label')}>
            <Input
              placeholder={t('entities.customFields.editor.optionLabelPlaceholder', 'Label shown to users (optional)')}
              value={optionLabelDraft}
              onChange={(event) => setOptionLabelDraft(event.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCloseOptionDialog}>
            {t('entities.customFields.editor.cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={handleAddOption}>
            {t('entities.customFields.editor.addOption', 'Add option')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog
      open={groupDialogOpen}
      onOpenChange={(open) => {
        setGroupDialogOpen(open)
        if (!open) {
          setGroupError(null)
          setEditingGroupCode(null)
          setGroupDraft({ code: '', title: '', hint: '' })
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingGroupCode
              ? t('entities.customFields.editor.editGroup', 'Edit group')
              : t('entities.customFields.editor.newGroup', 'New group')}
          </DialogTitle>
          <DialogDescription>
            {editingGroupCode
              ? t('entities.customFields.editor.editGroupDescription', 'Update the selected group for this fieldset.')
              : t('entities.customFields.editor.newGroupDescription', 'Add a reusable group for this fieldset.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label={t('entities.customFields.editor.groupCode', 'Group code')} error={groupError ?? undefined} disabled={!!editingGroupCode}>
            <Input
              inputClassName="font-mono"
              value={groupDraft.code}
              onChange={(event) => {
                setGroupDraft((prev) => ({ ...prev, code: event.target.value }))
                if (groupError) setGroupError(null)
              }}
              disabled={!!editingGroupCode}
              placeholder={t('entities.customFields.editor.groupCodePlaceholder', 'e.g. buying_committee')}
            />
          </FormField>
          <FormField label={t('entities.customFields.editor.label', 'Label')}>
            <Input
              value={groupDraft.title}
              onChange={(event) => setGroupDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder={t('entities.customFields.editor.groupLabelPlaceholder', 'Buying committee')}
            />
          </FormField>
          <FormField label={t('entities.customFields.editor.hint', 'Hint')}>
            <Input
              value={groupDraft.hint}
              onChange={(event) => setGroupDraft((prev) => ({ ...prev, hint: event.target.value }))}
              placeholder={t('entities.customFields.editor.groupHintPlaceholder', 'Visible to merchandisers')}
            />
          </FormField>
          {currentFieldsetValue && groupOptions.length > 0 ? (
            <div>
              <div className="text-xs font-medium mb-1">{t('entities.customFields.editor.existingGroups', 'Existing groups')}</div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {groupOptions.map((group) => (
                  <div key={group.code} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{group.title || group.code}</div>
                      <div className="text-xs text-muted-foreground font-mono">{group.code}</div>
                      {group.hint ? (
                        <div className="text-xs text-muted-foreground">{group.hint}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <IconButton
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditGroupEntry(group)}
                        aria-label={t('entities.customFields.editor.editGroupAria', 'Edit {code}', { code: group.code })}
                      >
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive/80"
                        onClick={() => handleRemoveGroupEntry(group.code)}
                        aria-label={t('entities.customFields.editor.deleteGroupAria', 'Delete {code}', { code: group.code })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setGroupDialogOpen(false)}>
            {t('entities.customFields.editor.cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={handleGroupDialogSubmit}>
            {t('entities.customFields.editor.saveGroup', 'Save group')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
})

FieldDefinitionCard.displayName = 'FieldDefinitionCard'
