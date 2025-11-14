"use client"

import * as React from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/entities/kinds'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'

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
  onAddField: () => void
  onRemoveField: (index: number) => void
  onDefinitionChange: (index: number, next: FieldDefinition) => void
  onRestoreField?: (key: string) => void
  onReorder?: (from: number, to: number) => void
  listRef?: React.Ref<HTMLDivElement>
  listProps?: React.HTMLAttributes<HTMLDivElement>
}

const DEFAULT_KIND_OPTIONS = CUSTOM_FIELD_KINDS.map((k) => ({
  value: k,
  label: k.charAt(0).toUpperCase() + k.slice(1),
}))

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
  onAddField,
  onRemoveField,
  onDefinitionChange,
  onRestoreField,
  onReorder,
  listRef,
  listProps,
}: FieldDefinitionsEditorProps) {
  const dragIndex = React.useRef<number | null>(null)

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
      {orderNotice?.dirty && (
        <div className="sticky top-0 z-10 -mt-1 -mb-1">
          <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border bg-amber-50 text-amber-800 shadow-sm">
            {orderNotice?.saving ? 'Saving order…' : (orderNotice?.message ?? 'Reordered — saving soon')}
          </div>
        </div>
      )}
      {definitions.map((definition, index) => (
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
}

const FieldDefinitionCard = React.memo(function FieldDefinitionCard({
  definition,
  error,
  kindOptions,
  onChange,
  onRemove,
}: FieldDefinitionCardProps) {
  const [local, setLocal] = React.useState<FieldDefinition>(definition)
  React.useEffect(() => { setLocal(definition) }, [definition.key])

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
          <>
            <div className="md:col-span-2">
              <label className="text-xs">Options (one per line)</label>
              <textarea
                className="border rounded w-full px-2 py-1 text-sm min-h-[100px]"
                value={Array.isArray(local.configJson?.options) ? local.configJson!.options.join('\n') : ''}
                onChange={(event) => {
                  const options = event.target.value.split('\n')
                  apply({ configJson: { ...(local.configJson || {}), options } })
                }}
                onBlur={commit}
              />
            </div>
          </>
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

        {local.kind === 'dictionary' && (
          <div className="md:col-span-2">
            <label className="text-xs">Dictionary ID</label>
            <input
              className="border rounded w-full px-2 py-1 text-sm font-mono"
              placeholder="module:dictionary"
              value={local.configJson?.dictionaryId || ''}
              onChange={(event) => apply({ configJson: { ...(local.configJson || {}), dictionaryId: event.target.value } })}
              onBlur={commit}
            />
          </div>
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
