"use client"

import * as React from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/entities/kinds'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'

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
  listRef?: React.Ref<HTMLDivElement>
  listProps?: React.HTMLAttributes<HTMLDivElement>
  singleFieldsetPerRecord?: boolean
  onSingleFieldsetPerRecordChange?: (value: boolean) => void
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
]

function slugifyFieldsetCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '')
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
    <div className="text-xs text-gray-500 mt-2">
      Supported kinds: text, multiline, integer, float, boolean, select (with options/optionsUrl), relation (with related entity and options URL).
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
  listRef,
  listProps,
}: FieldDefinitionsEditorProps) {
  const dragIndex = React.useRef<number | null>(null)
  const hasFieldsets = fieldsets.length > 0
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

  const handleRemoveFieldset = () => {
    if (!onFieldsetsChange) return
    if (!resolvedActiveFieldset) return
    if (!window.confirm(`Delete fieldset "${resolvedActiveFieldset}"? This will move its fields to Unassigned.`)) return
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
        <div className="rounded border bg-white p-3 space-y-3">
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
              className="px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
            <button
              type="button"
              onClick={handleRemoveFieldset}
              disabled={!resolvedActiveFieldset}
              className="px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1 text-xs disabled:opacity-50"
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
      ) : null}
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
          />
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={onAddField}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 inline-flex items-center gap-1"
        >
          <Plus className="h-4 w-4" /> {addButtonLabel}
        </button>
        {infoNote}
        {deletedKeys && deletedKeys.length > 0 && onRestoreField ? (
          <div className="text-xs text-gray-500 mt-2">
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
}: FieldDefinitionCardProps) {
  const [local, setLocal] = React.useState<FieldDefinition>(definition)
  const [optionDraft, setOptionDraft] = React.useState('')
  React.useEffect(() => { setLocal(definition) }, [definition.key])
  React.useEffect(() => { setOptionDraft('') }, [definition.key])
  const currentFieldsetValue = typeof local.configJson?.fieldset === 'string' ? local.configJson.fieldset : ''
  const currentGroup = React.useMemo(() => normalizeGroupValue(local.configJson?.group), [local])
  const groupOptions = React.useMemo(() => {
    const list = Array.isArray(availableGroups) ? [...availableGroups] : []
    if (currentGroup && !list.some((entry) => entry.code === currentGroup.code)) {
      list.push(currentGroup)
    }
    return list
  }, [availableGroups, currentGroup])

  const sanitize = (def: FieldDefinition): FieldDefinition => {
    if (!def.configJson || !Array.isArray(def.configJson.options)) return def
    const normalizedOptions = def.configJson.options
      .map((option: unknown) => (typeof option === 'string' ? option.trim() : ''))
      .filter((option: string) => option.length > 0)
    if (
      normalizedOptions.length === def.configJson.options.length &&
      normalizedOptions.every((option: string, idx: number) => option === def.configJson.options[idx])
    ) {
      return def
    }
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

  const handleAddGroup = () => {
    if (!currentFieldsetValue) return
    const rawCode = window.prompt('Enter new group code (letters, numbers, underscores):', '')
    if (!rawCode) return
    const code = slugifyFieldsetCode(rawCode)
    if (!code) return
    const title = window.prompt('Enter group title (optional):', '') || undefined
    const hint = window.prompt('Enter group hint/description (optional):', '') || undefined
    const group: FieldsetGroup = { code, title: title?.trim() || undefined, hint: hint?.trim() || undefined }
    onRegisterGroup?.(currentFieldsetValue, group)
    const nextConfig = { ...(local.configJson || {}) }
    nextConfig.group = group
    apply({ configJson: nextConfig }, true)
  }

  const handleGroupDetailChange = (patch: Partial<FieldsetGroup>) => {
    if (!currentFieldsetValue || !currentGroup) return
    const nextGroup = { ...currentGroup, ...patch }
    const nextConfig = { ...(local.configJson || {}) }
    nextConfig.group = nextGroup
    apply({ configJson: nextConfig }, true)
    onRegisterGroup?.(currentFieldsetValue, nextGroup)
  }

  const handleAddOption = () => {
    const raw = optionDraft.trim()
    if (!raw) return
    const sanitized = raw.replace(/[^a-zA-Z0-9:_\-\s]/g, '')
    if (!sanitized) return
    const nextOptions = Array.isArray(local.configJson?.options) ? [...local.configJson!.options] : []
    nextOptions.push(sanitized)
    apply({ configJson: { ...(local.configJson || {}), options: nextOptions } }, true)
    setOptionDraft('')
  }

  const handleRemoveOption = (index: number) => {
    const nextOptions = Array.isArray(local.configJson?.options) ? [...local.configJson!.options] : []
    nextOptions.splice(index, 1)
    apply({ configJson: { ...(local.configJson || {}), options: nextOptions } }, true)
  }

  return (
    <div className="rounded border p-3 bg-white transition-colors hover:border-muted-foreground/60">
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
          <button type="button" onClick={onRemove} className="px-2 py-1 border rounded hover:bg-gray-50" aria-label="Remove field">
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
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline"
                  onClick={handleAddGroup}
                >
                  + New group
                </button>
              </div>
              <select
                className="border rounded w-full px-2 py-1 text-sm"
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
              {currentGroup ? (
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <input
                    className="border rounded w-full px-2 py-1 text-xs"
                    placeholder="Group title"
                    value={currentGroup.title ?? ''}
                    onChange={(event) => handleGroupDetailChange({ title: event.target.value })}
                  />
                  <input
                    className="border rounded w-full px-2 py-1 text-xs"
                    placeholder="Hint / description"
                    value={currentGroup.hint ?? ''}
                    onChange={(event) => handleGroupDetailChange({ hint: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs">Label</label>
          <input
            className="border rounded w-full px-2 py-1 text-sm"
            value={local.configJson?.label || ''}
            onChange={(event) => apply({ configJson: { ...(local.configJson || {}), label: event.target.value } })}
            onBlur={commit}
          />
        </div>
        <div>
          <label className="text-xs">Description</label>
          <input
            className="border rounded w-full px-2 py-1 text-sm"
            value={local.configJson?.description || ''}
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
                value={local.configJson?.editor || ''}
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
          <div className="md:col-span-6 space-y-2">
            <label className="text-xs">Options (code:value)</label>
            <div className="flex gap-2">
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                value={optionDraft}
                onChange={(event) => setOptionDraft(event.target.value)}
                placeholder="size:Large"
              />
              <button
                type="button"
                className="px-3 py-1 border rounded text-xs hover:bg-gray-50"
                onClick={handleAddOption}
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Array.isArray(local.configJson?.options) ? local.configJson!.options : []).map((option, idx) => (
                <span key={`${option}-${idx}`} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs bg-gray-50">
                  {option}
                  <button type="button" onClick={() => handleRemoveOption(idx)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {(!Array.isArray(local.configJson?.options) || local.configJson!.options.length === 0) && (
                <span className="text-xs text-muted-foreground">No options defined.</span>
              )}
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
                value={local.configJson?.optionsUrl || ''}
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
                  value={local.configJson?.relatedEntityId || ''}
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

        {(local.kind === 'integer' || local.kind === 'float') && (
          <div className="md:col-span-2">
            <label className="text-xs">Units (optional)</label>
            <input
              className="border rounded w-full px-2 py-1 text-sm"
              placeholder="kg, cm, etc."
              value={local.configJson?.unit || ''}
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
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1"
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
                  className="px-2 py-1 border rounded hover:bg-gray-50"
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
      </div>
    </div>
  )
})

FieldDefinitionCard.displayName = 'FieldDefinitionCard'
