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
import { loadGeneratedFieldRegistrations } from '@open-mercato/ui/backend/fields/registry'
import type {
  CatalogAttributeDefinition,
  CatalogAttributeSchema,
} from '../../data/types'
import {
  FieldDefinitionsEditor,
  type FieldDefinition,
  type FieldDefinitionError,
} from '../../../entities/components/FieldDefinitionsEditor'
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
  const [definitionDrafts, setDefinitionDrafts] = React.useState<FieldDefinition[]>([])
  const [definitionErrors, setDefinitionErrors] = React.useState<Record<number, FieldDefinitionError>>({})
  const validateDefinition = React.useCallback((def: FieldDefinition): FieldDefinitionError => {
    const errors: FieldDefinitionError = {}
    if (!def.key?.trim()) {
      errors.key = t('catalog.products.create.attributeSchema.errors.key', 'Key is required')
    }
    if (!def.kind?.trim()) {
      errors.kind = t('catalog.products.create.attributeSchema.errors.kind', 'Kind is required')
    }
    return errors
  }, [t])
  const rebuildDefinitionErrors = React.useCallback((defs: FieldDefinition[]): Record<number, FieldDefinitionError> => {
    const next: Record<number, FieldDefinitionError> = {}
    defs.forEach((definition, index) => {
      const err = validateDefinition(definition)
      if (err.key || err.kind) next[index] = err
    })
    return next
  }, [validateDefinition])
  React.useEffect(() => { loadGeneratedFieldRegistrations().catch(() => {}) }, [])
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
    const baseDefinitions = mode === 'customize' ? (effectiveSchema?.definitions ?? []) : []
    const drafts = baseDefinitions.length
      ? baseDefinitions.map(catalogDefinitionToFieldDefinition)
      : [createEmptyFieldDefinition()]
    setDefinitionDrafts(drafts)
    setDefinitionErrors(rebuildDefinitionErrors(drafts))
    setSchemaLabel(
      mode === 'customize'
        ? selectedTemplate?.name ?? schemaOverride?.name ?? ''
        : '',
    )
    setEditorOpen(true)
  }

  const handleSaveOverride = () => {
    const validationMap = rebuildDefinitionErrors(definitionDrafts)
    setDefinitionErrors(validationMap)
    const hasErrors = Object.values(validationMap).some((error) => error.key || error.kind)
    if (hasErrors) return
    const overrideDefinitions = definitionDrafts
      .map(fieldDefinitionToCatalogDefinition)
      .filter((def): def is CatalogAttributeDefinition => !!def)
      .slice(0, 64)
    const name = schemaLabel.trim()
    const override = {
      version: Date.now(),
      name: name.length ? name : undefined,
      definitions: overrideDefinitions,
    }
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

  const handleDefinitionChange = React.useCallback((index: number, nextDef: FieldDefinition) => {
    setDefinitionDrafts((list) => list.map((def, idx) => (idx === index ? nextDef : def)))
    setDefinitionErrors((prev) => ({ ...prev, [index]: validateDefinition(nextDef) }))
  }, [validateDefinition])

  const handleAddDefinition = React.useCallback(() => {
    setDefinitionDrafts((list) => {
      const next = [...list, createEmptyFieldDefinition()]
      setDefinitionErrors(rebuildDefinitionErrors(next))
      return next
    })
  }, [rebuildDefinitionErrors])

  const handleRemoveDefinition = React.useCallback((index: number) => {
    setDefinitionDrafts((list) => {
      const next = list.filter((_, idx) => idx !== index)
      setDefinitionErrors(rebuildDefinitionErrors(next))
      return next
    })
  }, [rebuildDefinitionErrors])

  const handleReorderDefinitions = React.useCallback((from: number, to: number) => {
    setDefinitionDrafts((list) => {
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      setDefinitionErrors(rebuildDefinitionErrors(next))
      return next
    })
  }, [rebuildDefinitionErrors])

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
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {schemaLabel?.trim().length
                ? schemaLabel
                : t('catalog.products.create.attributeSchema.dialogTitle', 'Customize attribute schema')}
            </DialogTitle>
            <DialogDescription>
              {t('catalog.products.create.attributeSchema.dialogDescription', 'Define the attribute fields that should be captured for this product.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('catalog.products.create.attributeSchema.nameLabel', 'Schema name')}
              </label>
              <Input
                value={schemaLabel}
                onChange={(event) => setSchemaLabel(event.target.value)}
                placeholder={t('catalog.products.create.attributeSchema.namePlaceholder', 'e.g., Fashion base attributes')}
              />
            </div>
            <FieldDefinitionsEditor
              definitions={definitionDrafts}
              errors={definitionErrors}
              onAddField={handleAddDefinition}
              onRemoveField={handleRemoveDefinition}
              onDefinitionChange={handleDefinitionChange}
              onReorder={handleReorderDefinitions}
              addButtonLabel={t('catalog.products.create.attributeSchema.addField', 'Add field')}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel', 'Cancel')}
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleSaveOverride}>
              {t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function catalogDefinitionToFieldDefinition(definition: CatalogAttributeDefinition): FieldDefinition {
  const config: Record<string, unknown> = {
    label: definition.label,
    description: definition.description,
    options: definition.options,
    optionsUrl: (definition as any).optionsUrl,
    dictionaryId: (definition as any).dictionaryId,
    relatedEntityId: (definition as any).relatedEntityId,
    multi: (definition as any).multi,
    editor: (definition as any).editor,
    unit: (definition as any).unit,
    validation: (definition as any).validation,
    listVisible: (definition as any).listVisible,
    filterable: (definition as any).filterable,
    formEditable: (definition as any).formEditable,
    scope: definition.scope,
    defaultValue: (definition as any).defaultValue,
    required: (definition as any).required,
  }
  return {
    key: definition.key,
    kind: definition.kind,
    configJson: config,
    isActive: true,
  }
}

function fieldDefinitionToCatalogDefinition(definition: FieldDefinition): CatalogAttributeDefinition | null {
  const key = definition.key?.trim()
  if (!key) return null
  const config = definition.configJson || {}
  const label =
    typeof config.label === 'string' && config.label.trim().length
      ? config.label.trim()
      : key
  const result: CatalogAttributeDefinition = {
    key,
    kind: definition.kind,
    label,
    description:
      typeof config.description === 'string' && config.description.trim().length
        ? config.description.trim()
        : undefined,
    options: Array.isArray(config.options) ? config.options : undefined,
    optionsUrl:
      typeof config.optionsUrl === 'string' && config.optionsUrl.trim().length
        ? config.optionsUrl.trim()
        : undefined,
    scope: typeof config.scope === 'string' ? config.scope : undefined,
    defaultValue: config.defaultValue,
  }
  if (config.dictionaryId) (result as any).dictionaryId = config.dictionaryId
  if (config.relatedEntityId) (result as any).relatedEntityId = config.relatedEntityId
  if (config.multi !== undefined) (result as any).multi = config.multi
  if (config.editor) (result as any).editor = config.editor
  if (config.unit) (result as any).unit = config.unit
  if (Array.isArray(config.validation) && config.validation.length) {
    (result as any).validation = config.validation
  }
  if (config.listVisible !== undefined) (result as any).listVisible = config.listVisible
  if (config.filterable !== undefined) (result as any).filterable = config.filterable
  if (config.formEditable !== undefined) (result as any).formEditable = config.formEditable
  if (config.required !== undefined) (result as any).required = config.required
  else if (Array.isArray(config.validation)) {
    (result as any).required = config.validation.some((rule: any) => rule?.rule === 'required')
  }
  return result
}

function createEmptyFieldDefinition(): FieldDefinition {
  return { key: '', kind: 'text', configJson: {}, isActive: true }
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
