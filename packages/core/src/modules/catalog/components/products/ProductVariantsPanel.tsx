"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Trash2, Sparkles } from 'lucide-react'
import type { CatalogAttributeDefinition, CatalogAttributeSchema } from '../../../data/types'
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

  const updateDrafts = (next: VariantDraft[]) => {
    setValue('variantDrafts', next)
  }

  const addVariant = () => {
    updateDrafts([
      ...drafts,
      {
        id: createLocalId(),
        attributeValues: {},
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
    const combos = buildVariantCombinations(selectableDefinitions)
    if (!combos.length) return
    const generated = combos.map((combo, index) => ({
      id: createLocalId(),
      name: combo.label,
      attributeValues: combo.values,
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
          disabled={disabled || selectableDefinitions.length === 0}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t('catalog.products.create.variants.generate', 'Generate from attributes')}
        </Button>
        {selectableDefinitions.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            {t('catalog.products.create.variants.noAttributes', 'Add selectable attributes to auto-generate combinations.')}
          </span>
        ) : null}
      </div>
      {disabled ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.products.create.variants.disabled', 'Variants are only available for configurable products.')}
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
              onChange={updateVariant}
              onRemove={removeVariant}
              onToggleDefault={setDefaultVariant}
              onAttributeChange={handleAttributeValueChange}
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
  onChange: (id: string, patch: Partial<VariantDraft>) => void
  onRemove: (id: string) => void
  onToggleDefault: (id: string) => void
  onAttributeChange: (variantId: string, key: string, value: unknown) => void
  radioGroupName: string
}

function VariantCard({
  draft,
  currencyCode,
  selectableDefinitions,
  onChange,
  onRemove,
  onToggleDefault,
  onAttributeChange,
  radioGroupName,
}: VariantCardProps) {
  const t = useT()
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

type Combination = {
  values: Record<string, unknown>
  label: string
}

function buildVariantCombinations(definitions: CatalogAttributeDefinition[]): Combination[] {
  if (!definitions.length) return []
  const build = (index: number, acc: Combination[]): Combination[] => {
    if (index >= definitions.length) return acc
    const definition = definitions[index]
    const options = definition.options ?? []
    if (!options.length) return build(index + 1, acc)
    if (acc.length === 0) {
      const base = options.map((option) => ({
        values: { [definition.key]: option.value },
        label: String(option.label ?? option.value ?? ''),
      }))
      return build(index + 1, base)
    }
    const next: Combination[] = []
    for (const combo of acc) {
      for (const option of options) {
        next.push({
          values: { ...combo.values, [definition.key]: option.value },
          label: `${combo.label} / ${option.label ?? option.value}`,
        })
      }
    }
    return build(index + 1, next)
  }
  return build(0, [])
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `var_${Math.random().toString(36).slice(2, 10)}`
}
