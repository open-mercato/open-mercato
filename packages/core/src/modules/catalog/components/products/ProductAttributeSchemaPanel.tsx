"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  CatalogAttributeDefinition,
  CatalogAttributeSchema,
} from '../../../data/types'
import { useT } from '@/lib/i18n/context'

type CrudValues = Record<string, unknown>

type Props = {
  values: CrudValues
  setValue: (field: string, value: unknown) => void
}

type AttributeSchemaTemplate = {
  id: string
  name: string
  description?: string | null
  schema: CatalogAttributeSchema | null
}

type DefinitionDraft = CatalogAttributeDefinition & { tempId?: string }

const SUPPORTED_KINDS = ['text', 'multiline', 'integer', 'float', 'boolean', 'select'] as const

export function ProductAttributeSchemaPanel({ values, setValue }: Props) {
  const t = useT()
  const schemaId = typeof values.attributeSchemaId === 'string' ? values.attributeSchemaId : null
  const schemaOverride =
    values.attributeSchema && typeof values.attributeSchema === 'object'
      ? (values.attributeSchema as CatalogAttributeSchema)
      : null
  const attributeValues =
    values.attributeValues && typeof values.attributeValues === 'object'
      ? (values.attributeValues as Record<string, unknown>)
      : {}

  const [templates, setTemplates] = React.useState<AttributeSchemaTemplate[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [definitionDrafts, setDefinitionDrafts] = React.useState<DefinitionDraft[]>([])
  const [schemaLabel, setSchemaLabel] = React.useState('')

  React.useEffect(() => {
    let mounted = true
    async function loadTemplates() {
      setIsLoading(true)
      setError(null)
      try {
        const { ok, result } = await apiCall<{ items?: AttributeSchemaTemplate[] }>(
          '/api/catalog/attribute-schemas?pageSize=100&isActive=true',
        )
        if (!mounted) return
        if (ok && Array.isArray(result?.items)) {
          setTemplates(result.items)
        } else {
          setTemplates([])
        }
      } catch (err) {
        if (!mounted) return
        setTemplates([])
        setError(err instanceof Error ? err.message : t('catalog.products.create.attributeSchema.loadError', 'Unable to load attribute schemas'))
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    loadTemplates()
    return () => {
      mounted = false
    }
  }, [t])

  const selectedTemplate = React.useMemo(
    () => templates.find((template) => template.id === schemaId) ?? null,
    [schemaId, templates],
  )

  const effectiveSchema = schemaOverride ?? selectedTemplate?.schema ?? null

  const handleSchemaSelect = (nextId: string | null) => {
    setValue('attributeSchemaId', nextId)
    setValue('attributeSchema', null)
    if (!nextId) {
      setValue('attributeValues', {})
      setValue('attributeSchemaResolved', null)
    } else {
      const template = templates.find((tpl) => tpl.id === nextId)
      setValue('attributeSchemaResolved', template?.schema ?? null)
      if (template?.schema) {
        const resetValues: Record<string, unknown> = {}
        for (const def of template.schema.definitions ?? []) {
          if (def.defaultValue !== undefined) {
            resetValues[def.key] = def.defaultValue
          }
        }
        setValue('attributeValues', resetValues)
      }
    }
  }

  const openEditor = (mode: 'customize' | 'new') => {
    const baseDefinitions =
      mode === 'customize'
        ? (effectiveSchema?.definitions ?? [])
        : []
    const drafts = baseDefinitions.map((definition) => ({
      ...definition,
      tempId: createLocalId(),
    }))
    setDefinitionDrafts(drafts)
    setSchemaLabel(
      mode === 'customize'
        ? selectedTemplate?.name ?? t('catalog.products.create.attributeSchema.custom', 'Custom schema')
        : t('catalog.products.create.attributeSchema.new', 'New schema'),
    )
    setEditorOpen(true)
  }

  const handleSaveOverride = (defs: DefinitionDraft[]) => {
    const sanitized = defs
      .map((draft) => ({
        key: draft.key.trim(),
        label: draft.label.trim(),
        kind: SUPPORTED_KINDS.includes(draft.kind as any) ? draft.kind : 'text',
        required: draft.required ?? false,
        defaultValue: draft.defaultValue,
        options: sanitizeOptions(draft.options),
        scope: draft.scope,
      }))
      .filter((draft) => draft.key.length > 0 && draft.label.length > 0)
      .slice(0, 64)
    const override = { version: Date.now(), definitions: sanitized }
    setValue('attributeSchema', override)
    setValue('attributeSchemaResolved', override)
    setValue('attributeSchemaId', null)
    setValue('attributeValues', {})
    setEditorOpen(false)
  }

  const resetOverride = () => {
    setValue('attributeSchema', null)
    if (schemaId) {
      handleSchemaSelect(schemaId)
    } else {
      setValue('attributeValues', {})
      setValue('attributeSchemaResolved', null)
    }
  }

  const handleValueChange = (key: string, nextValue: unknown) => {
    setValue('attributeValues', { ...attributeValues, [key]: nextValue })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">
            {t('catalog.products.create.attributeSchema.label', 'Attribute schema')}
          </label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={schemaId ?? ''}
            onChange={(event) => {
              const next = event.target.value
              handleSchemaSelect(next.length ? next : null)
            }}
            disabled={isLoading}
          >
            <option value="">
              {t('catalog.products.create.attributeSchema.select', 'Select schema')}
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => openEditor(schemaId || schemaOverride ? 'customize' : 'new')}>
            {t('catalog.products.create.attributeSchema.customize', 'Customize')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => openEditor('new')}>
            {t('catalog.products.create.attributeSchema.newButton', 'New schema')}
          </Button>
          {(schemaOverride || schemaId) ? (
            <Button type="button" variant="ghost" onClick={resetOverride}>
              {t('catalog.products.create.attributeSchema.reset', 'Reset')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 text-sm font-medium">
          {t('catalog.products.create.attributeValues.title', 'Attribute values')}
        </div>
        {effectiveSchema && effectiveSchema.definitions?.length ? (
          <AttributeValuesEditor
            definitions={effectiveSchema.definitions}
            values={attributeValues}
            onChange={handleValueChange}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('catalog.products.create.attributeValues.empty', 'Select or define a schema to capture attributes.')}
          </p>
        )}
      </div>
      <AttributeSchemaEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        drafts={definitionDrafts}
        setDrafts={setDefinitionDrafts}
        title={schemaLabel}
        onSave={handleSaveOverride}
      />
    </div>
  )
}

type AttributeValuesEditorProps = {
  definitions: CatalogAttributeDefinition[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

function AttributeValuesEditor({ definitions, values, onChange }: AttributeValuesEditorProps) {
  const t = useT()
  if (!definitions.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('catalog.products.create.attributeValues.empty', 'Select or define a schema to capture attributes.')}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {definitions.map((definition) => (
        <div key={definition.key} className="space-y-1">
          <label className="text-sm font-medium">
            {definition.label}
            {definition.required ? <span className="ml-1 text-red-600">*</span> : null}
          </label>
          {renderAttributeInput(definition, values?.[definition.key], (value) =>
            onChange(definition.key, value),
          )}
        </div>
      ))}
    </div>
  )
}

function renderAttributeInput(
  definition: CatalogAttributeDefinition,
  value: unknown,
  onChange: (value: unknown) => void,
): React.ReactNode {
  const baseClass = 'w-full rounded border px-3 py-2 text-sm'
  switch (definition.kind) {
    case 'multiline':
      return (
        <textarea
          className={`${baseClass} min-h-[120px]`}
          value={value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'integer':
    case 'float':
      return (
        <input
          type="number"
          className={baseClass}
          value={value == null ? '' : String(value)}
          onChange={(event) => {
            const next = event.target.value
            onChange(next.length ? Number(next) : null)
          }}
        />
      )
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{definition.label}</span>
        </label>
      )
    case 'select':
      return (
        <select
          className={baseClass}
          value={value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{definition.required ? '—' : ''}</option>
          {(definition.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? option.value}
            </option>
          ))}
        </select>
      )
    default:
      return (
        <input
          type="text"
          className={baseClass}
          value={value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

type AttributeSchemaEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  drafts: DefinitionDraft[]
  setDrafts: React.Dispatch<React.SetStateAction<DefinitionDraft[]>>
  title: string
  onSave: (defs: DefinitionDraft[]) => void
}

function AttributeSchemaEditorDialog({
  open,
  onOpenChange,
  drafts,
  setDrafts,
  title,
  onSave,
}: AttributeSchemaEditorDialogProps) {
  const t = useT()
  const addDefinition = () => {
    setDrafts((list) => [
      ...list,
      {
        key: '',
        label: '',
        kind: 'text',
        scope: 'product',
        required: false,
        tempId: createLocalId(),
      },
    ])
  }

  const updateDraft = (tempId: string, patch: Partial<DefinitionDraft>) => {
    setDrafts((list) =>
      list.map((item) => (item.tempId === tempId ? { ...item, ...patch } : item)),
    )
  }

  const removeDraft = (tempId: string) => {
    setDrafts((list) => list.filter((item) => item.tempId !== tempId))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('catalog.products.create.attributeSchema.dialogDescription', 'Define the attribute fields that should be captured for this product.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('catalog.products.create.attributeSchema.empty', 'No fields yet. Add your first attribute.')}
            </p>
          ) : (
            drafts.map((draft) => (
              <div key={draft.tempId} className="rounded border p-3 space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.attributeSchema.fieldKey', 'Key')}
                    </label>
                    <Input
                      value={draft.key}
                      onChange={(event) => updateDraft(draft.tempId!, { key: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.attributeSchema.fieldLabel', 'Label')}
                    </label>
                    <Input
                      value={draft.label}
                      onChange={(event) => updateDraft(draft.tempId!, { label: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.attributeSchema.kind', 'Kind')}
                    </label>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={draft.kind}
                      onChange={(event) => updateDraft(draft.tempId!, { kind: event.target.value as DefinitionDraft['kind'] })}
                    >
                      {SUPPORTED_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.attributeSchema.scope', 'Scope')}
                    </label>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={draft.scope ?? 'product'}
                      onChange={(event) => updateDraft(draft.tempId!, { scope: event.target.value as DefinitionDraft['scope'] })}
                    >
                      <option value="product">{t('catalog.products.create.attributeSchema.scope.product', 'Product')}</option>
                      <option value="variant">{t('catalog.products.create.attributeSchema.scope.variant', 'Variant')}</option>
                      <option value="shared">{t('catalog.products.create.attributeSchema.scope.shared', 'Shared')}</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.required ?? false}
                        onChange={(event) => updateDraft(draft.tempId!, { required: event.target.checked })}
                      />
                      {t('catalog.products.create.attributeSchema.required', 'Required')}
                    </label>
                  </div>
                </div>
                {draft.kind === 'select' ? (
                  <OptionListEditor
                    options={draft.options ?? []}
                    onChange={(options) => updateDraft(draft.tempId!, { options })}
                  />
                ) : null}
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" onClick={() => removeDraft(draft.tempId!)}>
                    {t('catalog.products.create.attributeSchema.removeField', 'Remove')}
                  </Button>
                </div>
              </div>
            ))
          )}
          <Button type="button" variant="outline" onClick={addDefinition}>
            {t('catalog.products.create.attributeSchema.addField', 'Add field')}
          </Button>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('common.cancel', 'Cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => onSave(drafts)}>
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type OptionListEditorProps = {
  options: { value: unknown; label?: string }[]
  onChange: (options: { value: unknown; label?: string }[]) => void
}

function OptionListEditor({ options, onChange }: OptionListEditorProps) {
  const t = useT()
  const updateOption = (index: number, patch: Partial<{ value: unknown; label?: string }>) => {
    onChange(options.map((current, idx) => (idx === index ? { ...current, ...patch } : current)))
  }
  const removeOption = (index: number) => {
    onChange(options.filter((_, idx) => idx !== index))
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide">
        {t('catalog.products.create.attributeSchema.options', 'Options')}
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.attributeSchema.noOptions', 'No options yet.')}
        </p>
      ) : (
        options.map((option, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_2fr_auto]"
          >
            <Input
              placeholder={t('catalog.products.create.attributeSchema.optionValue', 'Value')}
              value={option.value == null ? '' : String(option.value)}
              onChange={(event) => updateOption(index, { value: event.target.value })}
            />
            <Input
              placeholder={t('catalog.products.create.attributeSchema.optionLabel', 'Label')}
              value={option.label ?? ''}
              onChange={(event) => updateOption(index, { label: event.target.value })}
            />
            <Button type="button" variant="ghost" onClick={() => removeOption(index)}>
              {t('catalog.products.create.attributeSchema.remove', 'Remove')}
            </Button>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...options, { value: '', label: '' }])}
      >
        {t('catalog.products.create.attributeSchema.addOption', 'Add option')}
      </Button>
    </div>
  )
}

function sanitizeOptions(options?: { value: unknown; label?: string }[] | null) {
  if (!Array.isArray(options)) return undefined
  return options
    .map((option) => {
      const value =
        typeof option.value === 'number' || typeof option.value === 'boolean'
          ? option.value
          : String(option.value ?? '').trim()
      if (value === '') return null
      const label = typeof option.label === 'string' ? option.label : undefined
      return { value, label }
    })
    .filter((option): option is { value: unknown; label?: string } => option !== null)
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tmp_${Math.random().toString(36).slice(2, 10)}`
}
