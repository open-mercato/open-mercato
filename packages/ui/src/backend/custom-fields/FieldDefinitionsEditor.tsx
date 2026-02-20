"use client"

import * as React from 'react'
import { Cog, GripVertical, Languages, Pencil, Plus, Trash2 } from 'lucide-react'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/entities/kinds'
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
  translate?: (key: string, fallback: string) => string
}

const DEFAULT_KIND_OPTIONS = CUSTOM_FIELD_KINDS.map((k) => ({
  value: k,
  label: k.charAt(0).toUpperCase() + k.slice(1),
}))

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
  kindOptions = DEFAULT_KIND_OPTIONS,
  orderNotice,
  infoNote = (
    <div className="text-xs text-muted-foreground mt-2">
      Supported kinds: text, multiline, integer, float, boolean, select (with options/optionsUrl), currency (fixed currencies list), relation (with related entity and options URL).
    </div>
  ),
  addButtonLabel = 'Add Field',
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
  const t = React.useCallback((key: string, fallback: string) => (translate ? translate(key, fallback) : fallback), [translate])
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
    const nextFieldsets = [...fieldsets, { code, label: 'New fieldset', icon: 'layers' }]
    onFieldsetsChange(nextFieldsets)
    onActiveFieldsetChange?.(code)
  }

  const handleRemoveFieldset = async () => {
    if (!onFieldsetsChange) return
    if (!resolvedActiveFieldset) return
    const confirmed = await confirm({
      title: `Delete fieldset "${resolvedActiveFieldset}"?`,
      text: 'This will move its fields to Unassigned.',
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
            <label className="text-xs font-medium text-muted-foreground">Fieldset</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={resolvedActiveFieldset ?? ''}
              onChange={(event) => handleActiveFieldsetChange(event.target.value)}
            >
              <option value="">Unassigned fields</option>
              {fieldsets.map((fs) => (
                <option key={fs.code} value={fs.code}>
                  {fs.label || fs.code}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddFieldset}
              className="px-2 py-1 border rounded hover:bg-muted inline-flex items-center gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
            <button
              type="button"
              onClick={handleRemoveFieldset}
              disabled={!resolvedActiveFieldset}
              className="px-2 py-1 border rounded hover:bg-muted inline-flex items-center gap-1 text-xs disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
          {resolvedActiveFieldset && activeFieldsetConfig ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs">Code</label>
                <input
                  className="border rounded w-full px-2 py-1 text-sm font-mono"
                  value={activeFieldsetConfig.code}
                  onChange={(event) => handleFieldsetCodeInput(activeFieldsetConfig.code, event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs">Label</label>
                <input
                  className="border rounded w-full px-2 py-1 text-sm"
                  value={activeFieldsetConfig.label}
                  onChange={(event) => handleFieldsetPatch(activeFieldsetConfig.code, { label: event.target.value })}
                />
              </div>
              <div>
                <label className="text-xs">Icon</label>
                <select
                  className="border rounded w-full px-2 py-1 text-sm"
                  value={activeFieldsetConfig.icon ?? ''}
                  onChange={(event) =>
                    handleFieldsetPatch(activeFieldsetConfig.code, {
                      icon: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Default</option>
                  {FIELDSET_ICON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs">Description</label>
                <input
                  className="border rounded w-full px-2 py-1 text-sm"
                  value={activeFieldsetConfig.description ?? ''}
                  onChange={(event) => handleFieldsetPatch(activeFieldsetConfig.code, { description: event.target.value })}
                />
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!canToggleSingleFieldset}
                checked={singleFieldsetChecked}
                onChange={(event) => onSingleFieldsetPerRecordChange?.(event.target.checked)}
              />
              Single fieldset per entity
            </label>
            {!canToggleSingleFieldset ? (
              <span className="text-muted-foreground">(add at least two fieldsets to toggle)</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground flex flex-col gap-3">
          <div>No fieldsets defined yet. Fieldsets let you group custom fields for different variants of the same entity (e.g., Fashion vs. Sport products).</div>
          <div>
            <button
              type="button"
              onClick={handleAddFieldset}
              className="px-3 py-1.5 border rounded bg-card text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add first fieldset
            </button>
          </div>
        </div>
      )}
      {orderNotice?.dirty && (
        <div className="sticky top-0 z-10 -mt-1 -mb-1">
          <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border bg-amber-50 text-amber-800 shadow-sm">
            {orderNotice?.saving ? 'Saving order…' : (orderNotice?.message ?? 'Reordered — saving soon')}
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
            kindOptions={kindOptions}
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
        <button
          type="button"
          onClick={onAddField}
          className="px-3 py-1.5 text-sm border rounded hover:bg-muted inline-flex items-center gap-1"
        >
          <Plus className="h-4 w-4" /> {addButtonLabel}
        </button>
        {infoNote}
        {deletedKeys && deletedKeys.length > 0 && onRestoreField ? (
          <div className="text-xs text-muted-foreground mt-2">
            Restore deleted fields:{' '}
            {deletedKeys.map((key, idx) => (
              <span key={key}>
                <button
                  type="button"
                  className="underline hover:no-underline text-blue-600 disabled:opacity-50"
                  onClick={() => onRestoreField(key)}
                >
                  {key}
                </button>
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
  translate?: (key: string, fallback: string) => string
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
  React.useEffect(() => { setLocal(definition) }, [definition.key])
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

  const apply = (patch: Partial<FieldDefinition> | ((current: FieldDefinition) => Partial<FieldDefinition>), propagateNow = false) => {
    setLocal((prev) => {
      const resolvedPatch = typeof patch === 'function' ? patch(prev) : patch
      const next = { ...prev, ...resolvedPatch }
      if (!propagateNow) return next
      const sanitized = sanitize(next)
      onChange(sanitized)
      return sanitized
    })
  }

  const commit = () => {
    setLocal((prev) => {
      const sanitized = sanitize(prev)
      onChange(sanitized)
      return sanitized
    })
  }

  const handleFieldsetSelect = (value: string) => {
    setLocal((prev) => {
      const nextConfig = { ...(prev.configJson || {}) }
      if (value) nextConfig.fieldset = value
      else delete nextConfig.fieldset
      delete nextConfig.group
      const next = { ...prev, configJson: nextConfig }
      onChange(next)
      return next
    })
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
      setGroupError('Group code is required.')
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
      setOptionFormError('Value is required')
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
          Drag to reorder
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={local.isActive !== false} onChange={(event) => { apply({ isActive: event.target.checked }, true) }} /> Active
          </label>
          {onTranslate && (
            <button type="button" onClick={onTranslate} className="px-2 py-1 border rounded hover:bg-muted" aria-label="Translate field">
              <Languages className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onRemove} className="px-2 py-1 border rounded hover:bg-muted" aria-label="Remove field">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        <div className="md:col-span-6">
          <label className="text-xs">Key</label>
          <input
            className={`rounded w-full px-2 py-1 text-sm font-mono ${error?.key ? 'border-red-500 border' : 'border'}`}
            placeholder="snake_case"
            value={local.key}
            onChange={(event) => apply({ key: event.target.value })}
            onBlur={commit}
          />
          {error?.key ? <div className="text-xs text-red-600 mt-1">{error.key}</div> : null}
        </div>
        <div className="md:col-span-6">
          <label className="text-xs">Kind</label>
          <select
            className={`rounded w-full px-2 py-1 text-sm ${error?.kind ? 'border-red-500 border' : 'border'}`}
            value={local.kind}
            onChange={(event) => { apply({ kind: event.target.value }, true) }}
          >
            {kindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {error?.kind ? <div className="text-xs text-red-600 mt-1">{error.kind}</div> : null}
      </div>
    </div>

      {allowFieldsetSelection ? (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs">Assign to fieldset</label>
            <select
              className="border rounded w-full px-2 py-1 text-sm"
              value={currentFieldsetValue}
              onChange={(event) => handleFieldsetSelect(event.target.value)}
            >
              <option value="">Unassigned</option>
              {(fieldsets || []).map((fs) => (
                <option key={fs.code} value={fs.code}>
                  {fs.label || fs.code}
                </option>
              ))}
            </select>
          </div>
          {currentFieldsetValue ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs">Group</label>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <select
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  value={currentGroup?.code ?? ''}
                  onChange={(event) => handleGroupSelect(event.target.value)}
                >
                  <option value="">No group</option>
                  {groupOptions.map((group) => (
                    <option key={group.code} value={group.code}>
                      {group.title || group.code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="h-8 w-8 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-muted/40"
                  onClick={() => handleOpenGroupDialog()}
                  aria-label="Create group"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="h-8 w-8 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-muted/40"
                  onClick={() => handleOpenGroupDialog()}
                  aria-label="Edit groups"
                >
                  <Cog className="h-4 w-4" />
                  <span className="sr-only">Edit groups</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs">Label</label>
          <input
            className="border rounded w-full px-2 py-1 text-sm"
            value={typeof local.configJson?.label === 'string' ? local.configJson.label : ''}
            onChange={(event) => apply({ configJson: { ...(local.configJson || {}), label: event.target.value } })}
            onBlur={commit}
          />
        </div>
        <div>
          <label className="text-xs">Description</label>
          <input
            className="border rounded w-full px-2 py-1 text-sm"
            value={typeof local.configJson?.description === 'string' ? local.configJson.description : ''}
            onChange={(event) => apply({ configJson: { ...(local.configJson || {}), description: event.target.value } })}
            onBlur={commit}
          />
        </div>

        {(local.kind === 'text' || local.kind === 'multiline') && (
          <>
            <div>
              <label className="text-xs">Editor</label>
              <select
                className="border rounded w-full px-2 py-1 text-sm"
                value={typeof local.configJson?.editor === 'string' ? local.configJson.editor : ''}
                onChange={(event) => { apply({ configJson: { ...(local.configJson || {}), editor: event.target.value || undefined } }, true) }}
              >
                <option value="">Default</option>
                <option value="markdown">Markdown (UIW)</option>
                <option value="simpleMarkdown">Simple Markdown</option>
                <option value="htmlRichText">HTML Rich Text</option>
              </select>
            </div>
            {local.kind === 'text' && (
              <>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={!!local.configJson?.multi} onChange={(event) => { apply({ configJson: { ...(local.configJson || {}), multi: event.target.checked } }, true) }} /> Multiple
                  </label>
                </div>
                {!!local.configJson?.multi && (
                  <div className="md:col-span-2">
                    <label className="text-xs">Multi-select input style</label>
                    <select
                      className="border rounded w-full px-2 py-1 text-sm"
                      value={local.configJson?.input === 'listbox' ? 'listbox' : 'default'}
                      onChange={(event) => {
                        const { value } = event.target
                        const nextConfig = { ...(local.configJson || {}) }
                        if (value === 'listbox') nextConfig.input = 'listbox'
                        else delete nextConfig.input
                        apply({ configJson: nextConfig }, true)
                      }}
                    >
                      <option value="default">Default</option>
                      <option value="listbox">Listbox (searchable)</option>
                    </select>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {local.kind === 'select' && (
          <div className="md:col-span-6 space-y-3">
            <label className="text-xs">Options</label>
            <div className="space-y-2">
              {resolvedOptions.length > 0 ? (
                resolvedOptions.map((option, idx) => (
                  <div
                    key={`${option.value}-${idx}`}
                    className="flex items-center justify-between rounded border px-3 py-2 text-xs bg-muted"
                  >
                    <div>
                      <div className="font-medium text-foreground">{option.label}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">{option.value}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(idx)}
                      className="text-red-500 hover:text-red-700"
                      aria-label="Remove option"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No options defined.</span>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs px-2 py-1 border rounded hover:bg-muted inline-flex items-center gap-1"
                onClick={handleOpenOptionDialog}
              >
                <Plus className="h-3.5 w-3.5" />
                Add option
              </button>
            </div>
          </div>
        )}

        {(local.kind === 'select' || local.kind === 'relation') && (
          <>
            <div>
              <label className="text-xs">Options URL</label>
              <input
                className="border rounded w-full px-2 py-1 text-sm"
                placeholder="/api/..."
                value={typeof local.configJson?.optionsUrl === 'string' ? local.configJson.optionsUrl : ''}
                onChange={(event) => apply({ configJson: { ...(local.configJson || {}), optionsUrl: event.target.value } })}
                onBlur={commit}
              />
            </div>
            {local.kind === 'relation' && (
              <div>
                <label className="text-xs">Related Entity ID</label>
                  <input
                    className="border rounded w-full px-2 py-1 text-sm font-mono"
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
              </div>
            )}
          </>
        )}

        {local.kind === 'currency' && (
          <div className="md:col-span-2">
            <label className="text-xs">Options source</label>
            <div className="rounded border bg-muted px-2 py-1 text-xs text-muted-foreground">
              /api/currencies/options
            </div>
          </div>
        )}

        {(local.kind === 'integer' || local.kind === 'float') && (
          <div className="md:col-span-2">
            <label className="text-xs">Units (optional)</label>
            <input
              className="border rounded w-full px-2 py-1 text-sm"
              placeholder="kg, cm, etc."
              value={typeof local.configJson?.unit === 'string' ? local.configJson.unit : ''}
              onChange={(event) => apply({ configJson: { ...(local.configJson || {}), unit: event.target.value } })}
              onBlur={commit}
            />
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Validation rules</label>
          <button
            type="button"
            className="text-xs px-2 py-1 border rounded hover:bg-muted inline-flex items-center gap-1"
            onClick={() => {
              apply((current) => {
                const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                list.push({ rule: 'required', message: 'This field is required' } as any)
                return { configJson: { ...(current.configJson || {}), validation: list } }
              }, true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </button>
        </div>
        <div className="space-y-2">
          {(Array.isArray(local.configJson?.validation) ? local.configJson!.validation : []).map((rule: any, index: number) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <div className="md:col-span-3">
                <select
                  className="border rounded w-full px-2 py-1 text-sm"
                  value={rule?.rule || 'required'}
                  onChange={(event) => {
                    const nextRule = event.target.value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[index] as any) || {}
                      list[index] = { ...existing, rule: nextRule, message: existing.message || rule?.message || '' }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    }, true)
                  }}
                >
                  <option value="required">required</option>
                  <option value="date">date</option>
                  <option value="integer">integer</option>
                  <option value="float">float</option>
                  <option value="lt">lt</option>
                  <option value="lte">lte</option>
                  <option value="gt">gt</option>
                  <option value="gte">gte</option>
                  <option value="eq">eq</option>
                  <option value="ne">ne</option>
                  <option value="regex">regex</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <input
                  className="border rounded w-full px-2 py-1 text-sm"
                  placeholder={rule?.rule === 'regex' ? 'Pattern (e.g. ^[a-z]+$)' : (['lt','lte','gt','gte'].includes(rule?.rule) ? 'Number' : '—')}
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
                <input
                  className="border rounded w-full px-2 py-1 text-sm"
                  placeholder="Error message"
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
                <button
                  type="button"
                  className="px-2 py-1 border rounded hover:bg-muted"
                  aria-label="Remove rule"
                  onClick={() => {
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      list.splice(index, 1)
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    }, true)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {(!Array.isArray(local.configJson?.validation) || local.configJson!.validation.length === 0) && (
            <div className="text-xs text-muted-foreground">No validation rules defined.</div>
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

      <div className="mt-3 pt-2 border-t flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted-foreground">Visibility:</span>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={local.configJson?.listVisible !== false}
            onChange={(event) => { apply({ configJson: { ...(local.configJson || {}), listVisible: event.target.checked } }, true) }}
          />
          List
        </label>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={!!local.configJson?.filterable}
            onChange={(event) => { apply({ configJson: { ...(local.configJson || {}), filterable: event.target.checked } }, true) }}
          />
          Filter
        </label>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={local.configJson?.formEditable !== false}
            onChange={(event) => { apply({ configJson: { ...(local.configJson || {}), formEditable: event.target.checked } }, true) }}
          />
          Form
        </label>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={!!local.configJson?.encrypted}
            onChange={(event) => { apply({ configJson: { ...(local.configJson || {}), encrypted: event.target.checked } }, true) }}
          />
          {translate?.('entities.customFields.fields.encrypted', 'Encrypted') ?? 'Encrypted'}
        </label>
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
          <DialogTitle>Add option</DialogTitle>
          <DialogDescription>Provide the stored value and optional label shown to users.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs">Value</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm font-mono"
              placeholder="unique_value"
              value={optionValueDraft}
              onChange={(event) => {
                setOptionFormError(null)
                setOptionValueDraft(event.target.value)
              }}
            />
            {optionFormError ? <p className="mt-1 text-xs text-red-600">{optionFormError}</p> : null}
          </div>
          <div>
            <label className="text-xs">Label</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              placeholder="Label shown to users (optional)"
              value={optionLabelDraft}
              onChange={(event) => setOptionLabelDraft(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            className="h-8 rounded border px-3 text-sm"
            onClick={handleCloseOptionDialog}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-8 rounded bg-primary px-3 text-sm text-primary-foreground"
            onClick={handleAddOption}
          >
            Add option
          </button>
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
          <DialogTitle>{editingGroupCode ? 'Edit group' : 'New group'}</DialogTitle>
          <DialogDescription>
            {editingGroupCode ? 'Update the selected group for this fieldset.' : 'Add a reusable group for this fieldset.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Group code</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm font-mono disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground"
              value={groupDraft.code}
              onChange={(event) => {
                setGroupDraft((prev) => ({ ...prev, code: event.target.value }))
                if (groupError) setGroupError(null)
              }}
              disabled={!!editingGroupCode}
              placeholder="e.g. buying_committee"
            />
            {groupError ? <div className="text-xs text-red-600 mt-1">{groupError}</div> : null}
          </div>
          <div>
            <label className="text-xs font-medium">Label</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={groupDraft.title}
              onChange={(event) => setGroupDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Buying committee"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Hint</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={groupDraft.hint}
              onChange={(event) => setGroupDraft((prev) => ({ ...prev, hint: event.target.value }))}
              placeholder="Visible to merchandisers"
            />
          </div>
          {currentFieldsetValue && groupOptions.length > 0 ? (
            <div>
              <div className="text-xs font-medium mb-1">Existing groups</div>
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
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditGroupEntry(group)}
                        aria-label={`Edit ${group.code}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => handleRemoveGroupEntry(group.code)}
                        aria-label={`Delete ${group.code}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            className="h-8 rounded border px-3 text-sm"
            onClick={() => setGroupDialogOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-8 rounded bg-primary px-3 text-sm text-primary-foreground"
            onClick={handleGroupDialogSubmit}
          >
            Save group
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
})

FieldDefinitionCard.displayName = 'FieldDefinitionCard'
