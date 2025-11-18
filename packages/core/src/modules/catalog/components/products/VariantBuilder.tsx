"use client"

import * as React from 'react'
import { useT } from '@/lib/i18n/context'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { ProductMediaManager } from './ProductMediaManager'
import { MetadataEditor } from './MetadataEditor'
import type { PriceKindSummary, TaxRateSummary } from './productForm'
import { formatTaxRateLabel } from './productForm'
import type { OptionDefinition, VariantFormValues, VariantPriceDraft } from './variantForm'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type VariantBuilderProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  optionDefinitions: OptionDefinition[]
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
}

export function VariantBuilder({
  values,
  setValue,
  errors,
  optionDefinitions,
  priceKinds,
  taxRates,
}: VariantBuilderProps) {
  const t = useT()
  const metadata = normalizeMetadata(values.metadata)
  const dimensionValues = normalizeDimensions(metadata)
  const weightValues = normalizeWeight(metadata)

  const handleOptionChange = React.useCallback(
    (code: string, next: string) => {
      setValue('optionValues', { ...(values.optionValues ?? {}), [code]: next })
    },
    [setValue, values.optionValues],
  )

  const updatePrice = React.useCallback(
    (priceKindId: string, patch: Partial<VariantPriceDraft>) => {
      const prev = values.prices?.[priceKindId] ?? { priceKindId, amount: '', displayMode: 'excluding-tax' }
      setValue('prices', { ...values.prices, [priceKindId]: { ...prev, ...patch, priceKindId } })
    },
    [setValue, values.prices],
  )

  const handleMetadataChange = React.useCallback(
    (next: Record<string, unknown>) => {
      setValue('metadata', next)
    },
    [setValue],
  )

  const inventoryFields = (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="flex items-center justify-between gap-2 rounded border px-3 py-2">
        <div>
          <p className="text-sm font-medium">{t('catalog.variants.form.isDefault', 'Default variant')}</p>
          <p className="text-xs text-muted-foreground">{t('catalog.variants.form.isDefault.hint', 'Used in storefronts')}</p>
        </div>
        <Switch checked={values.isDefault} onCheckedChange={(next) => setValue('isDefault', next)} />
      </label>
      <label className="flex items-center justify-between gap-2 rounded border px-3 py-2">
        <div>
          <p className="text-sm font-medium">{t('catalog.variants.form.isActive', 'Active')}</p>
          <p className="text-xs text-muted-foreground">{t('catalog.variants.form.isActive.hint', 'Inactive variants stay hidden')}</p>
        </div>
        <Switch checked={values.isActive !== false} onCheckedChange={(next) => setValue('isActive', next)} />
      </label>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          {t('catalog.variants.form.nameLabel', 'Name')}
          <span className="text-red-600">*</span>
        </Label>
        <Input
          value={values.name}
          onChange={(event) => setValue('name', event.target.value)}
          placeholder={t('catalog.variants.form.namePlaceholder', 'e.g., Blue / Small')}
        />
        {errors.name ? <p className="text-xs text-red-600">{errors.name}</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('catalog.variants.form.skuLabel', 'SKU')}</Label>
          <Input
            value={values.sku}
            onChange={(event) => setValue('sku', event.target.value)}
            placeholder={t('catalog.variants.form.skuPlaceholder', 'Unique identifier')}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('catalog.variants.form.barcodeLabel', 'Barcode')}</Label>
          <Input
            value={values.barcode}
            onChange={(event) => setValue('barcode', event.target.value)}
            placeholder={t('catalog.variants.form.barcodePlaceholder', 'EAN, UPC, etc.')}
          />
        </div>
      </div>

      {optionDefinitions.length ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t('catalog.variants.form.options', 'Option values')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {optionDefinitions.map((option) => (
              <div key={option.code} className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">{option.label}</Label>
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={values.optionValues?.[option.code] ?? ''}
                  onChange={(event) => handleOptionChange(option.code, event.target.value)}
                >
                  <option value="">{t('catalog.variants.form.optionPlaceholder', 'Select value')}</option>
                  {option.values.map((value) => (
                    <option key={value.id} value={value.label}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {inventoryFields}

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t('catalog.variants.form.dimensions', 'Dimensions & weight')}</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <DimensionInput
            label={t('catalog.variants.form.width', 'Width')}
            value={dimensionValues.width ?? ''}
            onChange={(value) => setValue('metadata', applyDimension(metadata, 'width', value))}
          />
          <DimensionInput
            label={t('catalog.variants.form.height', 'Height')}
            value={dimensionValues.height ?? ''}
            onChange={(value) => setValue('metadata', applyDimension(metadata, 'height', value))}
          />
          <DimensionInput
            label={t('catalog.variants.form.depth', 'Depth')}
            value={dimensionValues.depth ?? ''}
            onChange={(value) => setValue('metadata', applyDimension(metadata, 'depth', value))}
          />
          <DimensionInput
            label={t('catalog.variants.form.dimensionUnit', 'Size unit')}
            value={dimensionValues.unit ?? ''}
            onChange={(value) => setValue('metadata', applyDimension(metadata, 'unit', value))}
          />
          <DimensionInput
            label={t('catalog.variants.form.weight', 'Weight')}
            value={weightValues.value ?? ''}
            onChange={(value) => setValue('metadata', applyWeight(metadata, 'value', value))}
          />
          <DimensionInput
            label={t('catalog.variants.form.weightUnit', 'Weight unit')}
            value={weightValues.unit ?? ''}
            onChange={(value) => setValue('metadata', applyWeight(metadata, 'unit', value))}
          />
        </div>
      </div>

      <MetadataEditor value={metadata} onChange={handleMetadataChange} />

      <VariantPricesTable
        values={values}
        priceKinds={priceKinds}
        taxRates={taxRates}
        setValue={setValue}
        onPriceChange={updatePrice}
      />

      <div className="space-y-2">
        <Label>{t('catalog.variants.form.media', 'Media')}</Label>
        <ProductMediaManager
          entityId={E.catalog.catalog_product_variant}
          draftRecordId={values.mediaDraftId}
          items={Array.isArray(values.mediaItems) ? values.mediaItems : []}
          defaultMediaId={values.defaultMediaId}
          onItemsChange={(next) => setValue('mediaItems', next)}
          onDefaultChange={(next) => setValue('defaultMediaId', next)}
        />
      </div>
    </div>
  )
}

type PricesTableProps = {
  values: VariantFormValues
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
  setValue: (id: string, value: unknown) => void
  onPriceChange: (priceKindId: string, patch: Partial<VariantPriceDraft>) => void
}

function VariantPricesTable({ values, priceKinds, taxRates, setValue, onPriceChange }: PricesTableProps) {
  const t = useT()
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('catalog.variants.form.prices', 'Prices')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('catalog.variants.form.prices.hint', 'Populate list prices per price kind.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded border px-3 py-2 text-sm"
            value={values.taxRateId ?? ''}
            onChange={(event) => setValue('taxRateId', event.target.value || null)}
          >
            <option value="">{t('catalog.variants.form.prices.taxNone', 'No tax override')}</option>
            {taxRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {formatTaxRateLabel(rate)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-3">
        {priceKinds.length ? (
          priceKinds.map((kind) => {
            const draft = values.prices?.[kind.id]
            return (
              <div key={kind.id} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{kind.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {kind.currencyCode
                        ? `${kind.currencyCode.toUpperCase()} • ${kind.displayMode === 'including-tax' ? t('catalog.priceKinds.form.displayMode.include', 'Including tax') : t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax')}`
                        : t('catalog.variants.form.priceMissingCurrency', 'No currency configured')}
                    </p>
                  </div>
                </div>
                <Input
                  className="mt-3"
                  value={draft?.amount ?? ''}
                  onChange={(event) => onPriceChange(kind.id, { amount: event.target.value })}
                  placeholder="0.00"
                />
              </div>
            )
          })
        ) : (
          <p className="text-xs text-muted-foreground">{t('catalog.variants.form.prices.empty', 'No price kinds configured yet.')}</p>
        )}
      </div>
    </div>
  )
}

function DimensionInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | number | undefined
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      <Input value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder="0" />
    </div>
  )
}

function normalizeMetadata(input: unknown): Record<string, any> {
  return typeof input === 'object' && input ? { ...(input as Record<string, unknown>) } : {}
}

function normalizeDimensions(metadata: Record<string, any>) {
  const raw = metadata.dimensions
  if (!raw || typeof raw !== 'object') return {}
  return {
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    depth: typeof raw.depth === 'number' ? raw.depth : undefined,
    unit: typeof raw.unit === 'string' ? raw.unit : undefined,
  }
}

function normalizeWeight(metadata: Record<string, any>) {
  const raw = metadata.weight
  if (!raw || typeof raw !== 'object') return {}
  return {
    value: typeof raw.value === 'number' ? raw.value : undefined,
    unit: typeof raw.unit === 'string' ? raw.unit : undefined,
  }
}

function applyDimension(metadata: Record<string, any>, field: 'width' | 'height' | 'depth' | 'unit', raw: string) {
  const dims = normalizeDimensions(metadata)
  if (field === 'unit') {
    dims.unit = raw
  } else {
    const numeric = Number(raw)
    dims[field] = Number.isNaN(numeric) ? undefined : numeric
  }
  const clean = cleanupDimensions(dims)
  if (clean) return { ...metadata, dimensions: clean }
  const copy = { ...metadata }
  delete copy.dimensions
  return copy
}

function applyWeight(metadata: Record<string, any>, field: 'value' | 'unit', raw: string) {
  const weight = normalizeWeight(metadata)
  if (field === 'unit') weight.unit = raw
  else {
    const numeric = Number(raw)
    weight.value = Number.isNaN(numeric) ? undefined : numeric
  }
  const clean = cleanupWeight(weight)
  if (clean) return { ...metadata, weight: clean }
  const copy = { ...metadata }
  delete copy.weight
  return copy
}

function cleanupDimensions(dims: { width?: number; height?: number; depth?: number; unit?: string }) {
  const clean: Record<string, unknown> = {}
  if (typeof dims.width === 'number' && Number.isFinite(dims.width)) clean.width = dims.width
  if (typeof dims.height === 'number' && Number.isFinite(dims.height)) clean.height = dims.height
  if (typeof dims.depth === 'number' && Number.isFinite(dims.depth)) clean.depth = dims.depth
  if (typeof dims.unit === 'string' && dims.unit.trim().length) clean.unit = dims.unit
  return Object.keys(clean).length ? clean : null
}

function cleanupWeight(weight: { value?: number; unit?: string }) {
  const clean: Record<string, unknown> = {}
  if (typeof weight.value === 'number' && Number.isFinite(weight.value)) clean.value = weight.value
  if (typeof weight.unit === 'string' && weight.unit.trim().length) clean.unit = weight.unit
  return Object.keys(clean).length ? clean : null
}
