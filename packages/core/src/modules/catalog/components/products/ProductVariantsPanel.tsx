"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Trash2, Sparkles } from 'lucide-react'
import type { CatalogAttributeDefinition, CatalogAttributeSchema } from '../../data/types'
import type { CustomOptionDraft } from './ProductCustomOptionsPanel'
import { useT } from '@/lib/i18n/context'

type CrudValues = Record<string, unknown>

export type VariantDraft = {
  id: string
  name?: string
  sku?: string
  priceNet?: string
  priceGross?: string
  taxRate?: string
  isDefault?: boolean
  attributeValues?: Record<string, unknown>
  optionSelections?: Record<string, string>
}

type Props = {
  values: CrudValues
  setValue: (field: string, value: unknown) => void
  attributeSchema?: CatalogAttributeSchema | null
  currencyCode?: string | null
  disabled?: boolean
}

export function ProductVariantsPanel({
  values,
  setValue,
  attributeSchema,
  currencyCode,
  disabled = false,
}: Props) {
  const t = useT()
  const radioGroupName = React.useId()
  const drafts = React.useMemo(
    () =>
      Array.isArray(values.variantDrafts)
        ? (values.variantDrafts as VariantDraft[])
        : [],
    [values.variantDrafts],
  )

  const selectableDefinitions = React.useMemo(() => {
    const definitions = attributeSchema?.definitions ?? []
    return definitions.filter(
      (definition) =>
        definition.kind === 'select' &&
        Array.isArray(definition.options) &&
        definition.options.length > 0,
    )
  }, [attributeSchema])

  const selectableOptions = React.useMemo<SelectableOption[]>(() => {
    const drafts = Array.isArray(values.customOptions)
      ? (values.customOptions as CustomOptionDraft[])
      : []
    return drafts
      .filter((option) => option.inputType === 'select' && Array.isArray(option.choices))
      .map((option) => {
        const codeSource = option.code?.trim().length ? option.code : option.label ?? ''
        const normalizedCode = normalizeOptionCode(codeSource)
        if (!normalizedCode) return null
        const choices = (option.choices ?? [])
          .map((choice) => {
            const choiceCode = normalizeOptionCode(choice.value)
            if (!choiceCode) return null
            const label = choice.label?.trim().length
              ? choice.label.trim()
              : choice.value.trim()
            return { code: choiceCode, label }
          })
          .filter((entry): entry is { code: string; label: string } => Boolean(entry))
        if (!choices.length) return null
        return {
          code: normalizedCode,
          label: option.label?.trim().length ? option.label.trim() : normalizedCode,
          choices,
        }
      })
      .filter((entry): entry is SelectableOption => Boolean(entry))
  }, [values.customOptions])

  const updateDrafts = (next: VariantDraft[]) => {
    setValue('variantDrafts', next)
  }

  const addVariant = () => {
    updateDrafts([
      ...drafts,
      {
        id: createLocalId(),
        attributeValues: {},
        optionSelections: {},
        isDefault: drafts.length === 0,
      },
    ])
  }

  const updateVariant = (id: string, patch: Partial<VariantDraft>) => {
    updateDrafts(
      drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
  }

  const removeVariant = (id: string) => {
    updateDrafts(drafts.filter((draft) => draft.id !== id))
  }

  const setDefaultVariant = (id: string) => {
    updateDrafts(
      drafts.map((draft) => ({
        ...draft,
        isDefault: draft.id === id,
      })),
    )
  }

  const handleGenerate = () => {
    const combos = buildOptionCombinations(selectableOptions)
    if (!combos.length) return
    const generated = combos.map((combo, index) => ({
      id: createLocalId(),
      name: combo.label,
      optionSelections: combo.selections,
      attributeValues: {},
      sku: '',
      priceNet: '',
      priceGross: '',
      taxRate: '',
      isDefault: index === 0,
    }))
    updateDrafts(generated)
  }

  const handleAttributeValueChange = (variantId: string, key: string, nextValue: unknown) => {
    const draft = drafts.find((entry) => entry.id === variantId)
    if (!draft) return
    const nextValues = { ...(draft.attributeValues ?? {}), [key]: nextValue }
    updateVariant(variantId, { attributeValues: nextValues })
  }

  const handleOptionSelectionChange = (
    variantId: string,
    optionCode: string,
    value: string,
  ) => {
    const draft = drafts.find((entry) => entry.id === variantId)
    if (!draft) return
    const sanitized = sanitizeOptionSelections(draft.optionSelections, selectableOptions)
    const next = { ...sanitized }
    if (!value.length) delete next[optionCode]
    else next[optionCode] = value
    updateVariant(variantId, { optionSelections: next })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={addVariant} disabled={disabled}>
          {t('catalog.products.create.variants.add', 'Add variant')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleGenerate}
          disabled={disabled || selectableOptions.length === 0}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t('catalog.products.create.variants.generate', 'Generate from options')}
        </Button>
        {selectableOptions.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            {t(
              'catalog.products.create.variants.noOptions',
              'Define select-type custom options to auto-generate combinations.',
            )}
          </span>
        ) : null}
      </div>
      {disabled ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'catalog.products.create.variants.disabled',
            'Variants are available for configurable, virtual, or downloadable products.',
          )}
        </p>
      ) : null}
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.products.create.variants.empty', 'No variants yet. Add one to start.')}
        </p>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <VariantCard
              key={draft.id}
              draft={draft}
              currencyCode={currencyCode}
              selectableDefinitions={selectableDefinitions}
              selectableOptions={selectableOptions}
              onChange={updateVariant}
              onRemove={removeVariant}
              onToggleDefault={setDefaultVariant}
              onAttributeChange={handleAttributeValueChange}
              onOptionChange={handleOptionSelectionChange}
              radioGroupName={radioGroupName}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type VariantCardProps = {
  draft: VariantDraft
  currencyCode?: string | null
  selectableDefinitions: CatalogAttributeDefinition[]
  selectableOptions: SelectableOption[]
  onChange: (id: string, patch: Partial<VariantDraft>) => void
  onRemove: (id: string) => void
  onToggleDefault: (id: string) => void
  onAttributeChange: (variantId: string, key: string, value: unknown) => void
  onOptionChange: (variantId: string, optionCode: string, value: string) => void
  radioGroupName: string
}

function VariantCard({
  draft,
  currencyCode,
  selectableDefinitions,
  selectableOptions,
  onChange,
  onRemove,
  onToggleDefault,
  onAttributeChange,
  onOptionChange,
  radioGroupName,
}: VariantCardProps) {
  const t = useT()
  const optionSelections = React.useMemo(
    () => sanitizeOptionSelections(draft.optionSelections, selectableOptions),
    [draft.optionSelections, selectableOptions],
  )
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.variants.name', 'Name')}
          </label>
          <Input
            placeholder={t('catalog.products.create.variants.namePlaceholder', 'e.g., Blue / L')}
            value={draft.name ?? ''}
            onChange={(event) => onChange(draft.id, { name: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">SKU</label>
          <Input
            value={draft.sku ?? ''}
            onChange={(event) => onChange(draft.id, { sku: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.net', 'Net price')}
          </label>
          <Input
            type="number"
            placeholder={currencyCode ?? 'USD'}
            value={draft.priceNet ?? ''}
            onChange={(event) => onChange(draft.id, { priceNet: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.gross', 'Gross price')}
          </label>
          <Input
            type="number"
            value={draft.priceGross ?? ''}
            onChange={(event) => onChange(draft.id, { priceGross: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.taxRate', 'Tax rate')}
          </label>
          <Input
            type="number"
            value={draft.taxRate ?? ''}
            onChange={(event) => onChange(draft.id, { taxRate: event.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={radioGroupName}
            checked={Boolean(draft.isDefault)}
            onChange={() => onToggleDefault(draft.id)}
          />
          {t('catalog.products.create.variants.default', 'Default variant')}
        </label>
        <Button type="button" variant="ghost" onClick={() => onRemove(draft.id)}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('catalog.products.create.remove', 'Remove')}
        </Button>
      </div>
      {selectableOptions.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {selectableOptions.map((option) => (
            <div key={option.code}>
              <label className="text-xs font-medium uppercase tracking-wide">
                {option.label}
              </label>
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={optionSelections[option.code] ?? ''}
                onChange={(event) => onOptionChange(draft.id, option.code, event.target.value)}
              >
                <option value="">
                  {t('catalog.products.create.selectPlaceholder', 'Select value')}
                </option>
                {option.choices.map((choice) => (
                  <option key={choice.code} value={choice.code}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ) : null}
      {selectableDefinitions.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {selectableDefinitions.map((definition) => (
            <div key={definition.key}>
              <label className="text-xs font-medium uppercase tracking-wide">
                {definition.label}
              </label>
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={
                  draft.attributeValues && draft.attributeValues[definition.key] != null
                    ? String(draft.attributeValues[definition.key])
                    : ''
                }
                onChange={(event) =>
                  onAttributeChange(draft.id, definition.key, event.target.value)
                }
              >
                <option value="">
                  {t('catalog.products.create.selectPlaceholder', 'Select value')}
                </option>
                {(definition.options ?? []).map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label ?? option.value}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type SelectableOption = {
  code: string
  label: string
  choices: Array<{ code: string; label: string }>
}

type OptionCombination = {
  selections: Record<string, string>
  label: string
}

function buildOptionCombinations(options: SelectableOption[]): OptionCombination[] {
  if (!options.length) return []
  const build = (index: number, acc: OptionCombination[]): OptionCombination[] => {
    if (index >= options.length) return acc
    const option = options[index]
    if (!option.choices.length) return build(index + 1, acc)
    if (acc.length === 0) {
      const base = option.choices.map((choice) => ({
        selections: { [option.code]: choice.code },
        label: `${option.label}: ${choice.label}`,
      }))
      return build(index + 1, base)
    }
    const next: OptionCombination[] = []
    for (const combo of acc) {
      for (const choice of option.choices) {
        next.push({
          selections: { ...combo.selections, [option.code]: choice.code },
          label: `${combo.label} / ${option.label}: ${choice.label}`,
        })
      }
    }
    return build(index + 1, next)
  }
  return build(0, [])
}

function sanitizeOptionSelections(
  selections: Record<string, string> | undefined,
  options: SelectableOption[],
): Record<string, string> {
  if (!selections) return {}
  const allowed = new Set(options.map((option) => option.code))
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(selections)) {
    if (!value || !allowed.has(key)) continue
    next[key] = value
  }
  return next
}

function normalizeOptionCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `var_${Math.random().toString(36).slice(2, 10)}`
}
