"use client"

import * as React from 'react'
import { Layers, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { CatalogProductOptionDefinition, CatalogProductOptionSchema } from '../../data/types'

export type CustomOptionDraft = {
  id: string
  label: string
  code: string
  description?: string
  inputType: 'text' | 'textarea' | 'number' | 'select'
  isRequired?: boolean
  isMultiple?: boolean
  choices?: Array<{ id: string; label: string; value: string }>
}

type OptionSchemaTemplate = {
  id: string
  name: string
  code: string
  description?: string | null
  schema: CatalogProductOptionSchema | null
}

type OptionSchemaTemplateResponse = {
  id: string
  name: string
  code: string
  description?: string | null
  schema?: CatalogProductOptionSchema | null
}

type CrudValues = Record<string, unknown>

type Props = {
  values: CrudValues
  setValue: (field: string, value: unknown) => void
}

const INPUT_TYPES: Array<CustomOptionDraft['inputType']> = ['text', 'textarea', 'number', 'select']

export function ProductCustomOptionsPanel({ values, setValue }: Props) {
  const t = useT()
  const options = Array.isArray(values.customOptions)
    ? (values.customOptions as CustomOptionDraft[])
    : []
  const scope = useOrganizationScopeDetail()
  const [templates, setTemplates] = React.useState<OptionSchemaTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = React.useState(false)
  const [templatesError, setTemplatesError] = React.useState<string | null>(null)
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false)
  const [templateName, setTemplateName] = React.useState('')
  const [templateCode, setTemplateCode] = React.useState('')
  const [templateFormError, setTemplateFormError] = React.useState<string | null>(null)
  const [savingTemplate, setSavingTemplate] = React.useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  const loadTemplates = React.useCallback(async () => {
    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const response = await apiCall<{ items?: OptionSchemaTemplateResponse[] }>(
        '/api/catalog/option-schemas?pageSize=100&isActive=true',
      )
      if (response.ok && Array.isArray(response.result?.items)) {
        const items = response.result.items as OptionSchemaTemplateResponse[]
        setTemplates(
          items.map((item) => ({
            id: item.id,
            name: item.name,
            code: item.code,
            description: item.description ?? null,
            schema: item.schema ?? null,
          })),
        )
      } else {
        setTemplates([])
        setTemplatesError(
          t('catalog.products.create.options.schemaLoadError', 'Unable to load option schemas.'),
        )
      }
    } catch (err) {
      setTemplates([])
      const message =
        err instanceof Error
          ? err.message
          : t('catalog.products.create.options.schemaLoadError', 'Unable to load option schemas.')
      setTemplatesError(message)
    } finally {
      setTemplatesLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    loadTemplates().catch(() => {})
  }, [loadTemplates])

  React.useEffect(() => {
    if (!templateMenuOpen) return
    const handle = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setTemplateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
    }
  }, [templateMenuOpen])

  const selectedTemplateId =
    typeof values.optionSchemaId === 'string' ? values.optionSchemaId : null

  const selectedTemplate = React.useMemo(
    () => (selectedTemplateId ? templates.find((tpl) => tpl.id === selectedTemplateId) ?? null : null),
    [selectedTemplateId, templates],
  )

  const updateOptions = (next: CustomOptionDraft[], preserveTemplate = false) => {
    if (!preserveTemplate) {
      setValue('optionSchemaId', null)
    }
    setValue('customOptions', next)
  }

  const handleTemplateSelect = (templateId: string | null) => {
    setValue('optionSchemaId', templateId)
    if (!templateId) return
    const template = templates.find((entry) => entry.id === templateId)
    if (template?.schema) {
      updateOptions(schemaToDrafts(template.schema), true)
    }
  }

  const openSaveDialog = React.useCallback(() => {
    setTemplateFormError(null)
    setTemplateName(selectedTemplate?.name ?? '')
    setTemplateCode(selectedTemplate?.code ?? '')
    setSaveDialogOpen(true)
  }, [selectedTemplate])

  const addOption = () => {
    updateOptions([
      ...options,
      {
        id: createLocalId(),
        label: '',
        code: '',
        inputType: 'text',
        isRequired: false,
        isMultiple: false,
        choices: [],
      },
    ])
  }

  const updateOption = (id: string, patch: Partial<CustomOptionDraft>) => {
    updateOptions(options.map((option) => (option.id === id ? { ...option, ...patch } : option)))
  }

  const removeOption = (id: string) => {
    updateOptions(options.filter((option) => option.id !== id))
  }

  const handleSaveTemplate = async () => {
    setTemplateFormError(null)
    const trimmedName = templateName.trim()
    if (!trimmedName.length) {
      setTemplateFormError(
        t('catalog.products.create.options.schemaNameRequired', 'Provide a template name.'),
      )
      return
    }
    const codeSource = templateCode.trim() || trimmedName
    const normalizedCode = normalizeOptionCode(codeSource)
    if (!normalizedCode.length) {
      setTemplateFormError(
        t('catalog.products.create.options.schemaCodeRequired', 'Provide a valid template code.'),
      )
      return
    }
    const schema = draftsToSchema(options)
    if (!schema.options.length) {
      setTemplateFormError(
        t('catalog.products.create.options.schemaEmpty', 'Add at least one option before saving.'),
      )
      return
    }
    if (!scope.organizationId || !scope.tenantId) {
      setTemplateFormError(
        t('catalog.products.create.options.scopeRequired', 'Select an organization before saving schemas.'),
      )
      return
    }
    setSavingTemplate(true)
    try {
      await createCrud('catalog/option-schemas', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: trimmedName,
        code: normalizedCode,
        schema,
        isActive: true,
      })
      flash(t('catalog.products.create.options.schemaSaved', 'Option schema saved.'), 'success')
      setSaveDialogOpen(false)
      setTemplateName('')
      setTemplateCode('')
      await loadTemplates()
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('catalog.products.create.options.schemaSaveError', 'Unable to save option schema.')
      setTemplateFormError(message)
    } finally {
      setSavingTemplate(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border bg-card p-3">
        <div>
          <p className="text-sm font-medium">
            {t('catalog.products.create.options.schemaLabel', 'Option schema')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('catalog.products.create.options.schemaHint', 'Start from a template or build your own option set.')}
          </p>
          {selectedTemplate ? (
            <p className="mt-1 text-xs text-primary">
              {t('catalog.products.create.options.schemaApplied', 'Using {{name}}', {
                name: selectedTemplate.name,
              })}
            </p>
          ) : null}
          {templatesError ? <p className="mt-1 text-xs text-red-600">{templatesError}</p> : null}
        </div>
        <div className="flex items-center gap-2" ref={menuRef}>
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setTemplateMenuOpen((prev) => !prev)}
            >
              <Layers className="h-4 w-4" />
              <span className="sr-only">
                {t('catalog.products.create.options.schemaMenu', 'Templates menu')}
              </span>
            </Button>
            {templateMenuOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-64 space-y-2 rounded-md border bg-card p-3 text-sm shadow-lg">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('catalog.products.create.options.templates', 'Templates')}
                  </p>
                  {templatesLoading ? (
                    <span className="text-xs text-muted-foreground">
                      {t('common.loading', 'Loading…')}
                    </span>
                  ) : null}
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {templates.length === 0 && !templatesLoading ? (
                    <p className="text-xs text-muted-foreground">
                      {t('catalog.products.create.options.noTemplates', 'No templates yet.')}
                    </p>
                  ) : (
                    templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          handleTemplateSelect(template.id)
                          setTemplateMenuOpen(false)
                        }}
                      >
                        <span>{template.name}</span>
                        {selectedTemplateId === template.id ? (
                          <span className="text-xs text-primary">
                            {t('common.selected', 'Selected')}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t pt-2 text-xs">
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left hover:bg-muted"
                    onClick={() => {
                      openSaveDialog()
                      setTemplateMenuOpen(false)
                    }}
                  >
                    {t('catalog.products.create.options.saveTemplate', 'Save current as template')}
                  </button>
                  {selectedTemplateId ? (
                    <button
                      type="button"
                      className="mt-1 w-full rounded px-2 py-1 text-left text-red-600 hover:bg-muted"
                      onClick={() => {
                        setValue('optionSchemaId', null)
                        setTemplateMenuOpen(false)
                      }}
                    >
                      {t('catalog.products.create.options.clearSchema', 'Clear selection')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={addOption}>
            <Plus className="h-4 w-4" />
            <span className="sr-only">
              {t('catalog.products.create.options.add', 'Add custom option')}
            </span>
          </Button>
        </div>
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.products.create.options.empty', 'No custom options yet.')}
        </p>
      ) : (
        <div className="space-y-4">
          {options.map((option) => (
            <div key={option.id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide">
                    {t('catalog.products.create.options.label', 'Label')}
                  </label>
                  <Input
                    value={option.label}
                    onChange={(event) => {
                      const nextLabel = event.target.value
                      updateOption(option.id, {
                        label: nextLabel,
                        code: option.code || slugify(nextLabel),
                      })
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide">Code</label>
                  <Input
                    value={option.code}
                    onChange={(event) => updateOption(option.id, { code: event.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide">
                    {t('catalog.products.create.options.type', 'Type')}
                  </label>
                  <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={option.inputType}
                    onChange={(event) =>
                      updateOption(option.id, {
                        inputType: event.target.value as CustomOptionDraft['inputType'],
                      })
                    }
                  >
                    {INPUT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={option.isRequired ?? false}
                      onChange={(event) => updateOption(option.id, { isRequired: event.target.checked })}
                    />
                    {t('catalog.products.create.options.required', 'Required')}
                  </label>
                  {option.inputType === 'select' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={option.isMultiple ?? false}
                        onChange={(event) => updateOption(option.id, { isMultiple: event.target.checked })}
                      />
                      {t('catalog.products.create.options.multiple', 'Allow multiple')}
                    </label>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide">
                  {t('catalog.products.create.options.description', 'Description')}
                </label>
                <Input
                  value={option.description ?? ''}
                  onChange={(event) => updateOption(option.id, { description: event.target.value })}
                />
              </div>
              {option.inputType === 'select' ? (
                <OptionChoicesEditor
                  choices={option.choices ?? []}
                  onChange={(choices) => updateOption(option.id, { choices })}
                />
              ) : null}
              <div className="flex justify-end">
                <Button type="button" variant="ghost" onClick={() => removeOption(option.id)}>
                  {t('catalog.products.create.remove', 'Remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={saveDialogOpen} onOpenChange={(next) => {
        setSaveDialogOpen(next)
        if (!next) setTemplateFormError(null)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('catalog.products.create.options.saveTemplateTitle', 'Save option schema')}</DialogTitle>
            <DialogDescription>
              {t('catalog.products.create.options.saveTemplateDescription', 'Reuse this option set across future products.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('catalog.products.create.options.schemaNameField', 'Name')}
              </label>
              <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('catalog.products.create.options.schemaCodeField', 'Code')}
              </label>
              <Input
                value={templateCode}
                onChange={(event) => setTemplateCode(event.target.value)}
                placeholder={t('catalog.products.create.options.schemaCodePlaceholder', 'Used internally, e.g. fashion-defaults')}
              />
            </div>
            {templateFormError ? <p className="text-xs text-red-600">{templateFormError}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={savingTemplate}>
                {t('common.cancel', 'Cancel')}
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleSaveTemplate} disabled={savingTemplate}>
              {savingTemplate ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type OptionChoicesEditorProps = {
  choices: NonNullable<CustomOptionDraft['choices']>
  onChange: (choices: NonNullable<CustomOptionDraft['choices']>) => void
}

function OptionChoicesEditor({ choices, onChange }: OptionChoicesEditorProps) {
  const t = useT()
  const addChoice = () => {
    onChange([
      ...choices,
      {
        id: createLocalId(),
        label: '',
        value: '',
      },
    ])
  }
  const updateChoice = (id: string, patch: Partial<{ label: string; value: string }>) => {
    onChange(choices.map((choice) => (choice.id === id ? { ...choice, ...patch } : choice)))
  }
  const removeChoice = (id: string) => {
    onChange(choices.filter((choice) => choice.id !== id))
  }
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide">
        {t('catalog.products.create.options.choices', 'Choices')}
      </div>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.options.noChoices', 'No choices yet.')}
        </p>
      ) : (
        choices.map((choice) => (
          <div
            key={choice.id}
            className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_2fr_auto]"
          >
            <Input
              placeholder={t('catalog.products.create.options.choiceValue', 'Value / code')}
              value={choice.value}
              onChange={(event) => updateChoice(choice.id, { value: event.target.value })}
            />
            <Input
              placeholder={t('catalog.products.create.options.choiceLabel', 'Label')}
              value={choice.label}
              onChange={(event) => updateChoice(choice.id, { label: event.target.value })}
            />
            <Button type="button" variant="ghost" onClick={() => removeChoice(choice.id)}>
              {t('catalog.products.create.options.removeChoice', 'Remove')}
            </Button>
          </div>
        ))
      )}
      <Button type="button" variant="secondary" onClick={addChoice}>
        {t('catalog.products.create.options.addChoice', 'Add choice')}
      </Button>
    </div>
  )
}

function schemaToDrafts(schema: CatalogProductOptionSchema | null): CustomOptionDraft[] {
  if (!schema || !Array.isArray(schema.options)) return []
  return schema.options
    .map((option) => {
      const label = option.label?.trim()
      const code = normalizeOptionCode(option.code || option.label || '')
      if (!label || !code) return null
      const base: CustomOptionDraft = {
        id: createLocalId(),
        label,
        code,
        description: option.description ?? '',
        inputType: option.inputType,
        isRequired: option.isRequired ?? false,
        isMultiple: option.isMultiple ?? false,
        choices:
          option.inputType === 'select'
            ? (option.choices ?? []).map((choice) => ({
                id: createLocalId(),
                value: choice.code,
                label: choice.label ?? choice.code,
              }))
            : [],
      }
      return base
    })
    .filter((draft): draft is CustomOptionDraft => draft !== null)
}

function draftsToSchema(drafts: CustomOptionDraft[]): CatalogProductOptionSchema {
  const options: CatalogProductOptionDefinition[] = drafts
    .map((draft) => {
      const label = draft.label?.trim()
      const code = normalizeOptionCode(draft.code || draft.label || '')
      if (!label || !code) return null
      const definition: CatalogProductOptionDefinition = {
        code,
        label,
        description: draft.description?.trim() || undefined,
        inputType: draft.inputType,
        isRequired: draft.isRequired ?? false,
        isMultiple: draft.isMultiple ?? false,
      }
      if (draft.inputType === 'select') {
        const choices = (draft.choices ?? [])
          .map((choice) => {
            const choiceCode = normalizeOptionCode(choice.value)
            if (!choiceCode) return null
            return {
              code: choiceCode,
              label: choice.label?.trim() || choice.value.trim() || choiceCode,
            }
          })
          .filter((entry): entry is { code: string; label: string } => Boolean(entry))
        definition.choices = choices
      }
      return definition
    })
    .filter((definition): definition is CatalogProductOptionDefinition => definition !== null)
  return {
    version: Date.now(),
    options,
  }
}

function normalizeOptionCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `opt_${Math.random().toString(36).slice(2, 10)}`
}
