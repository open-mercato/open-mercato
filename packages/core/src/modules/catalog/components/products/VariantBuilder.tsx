"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { ProductMediaManager } from './ProductMediaManager'
import { MetadataEditor } from './MetadataEditor'
import type { PriceKindSummary, TaxRateSummary } from './productForm'
import { formatTaxRateLabel } from './productForm'
import type { OptionDefinition, VariantFormValues, VariantPriceDraft } from './variantForm'
import { E } from '#generated/entities.ids.generated'

type VariantBuilderProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  optionDefinitions: OptionDefinition[]
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
}

type VariantSectionBaseProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
}

type VariantOptionValuesSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  optionDefinitions: OptionDefinition[]
  showHeading?: boolean
}

type VariantDimensionsSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showHeading?: boolean
}

type VariantMetadataSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showIntro?: boolean
  embedded?: boolean
}

type VariantPricesSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
  showHeader?: boolean
  embedded?: boolean
}

type VariantMediaSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showLabel?: boolean
}

export function VariantBuilder({
  values,
  setValue,
  errors,
  optionDefinitions,
  priceKinds,
  taxRates,
}: VariantBuilderProps) {
  return (
    <div className="space-y-6">
      <VariantBasicsSection values={values} setValue={setValue} errors={errors} />
      <VariantOptionValuesSection values={values} setValue={setValue} optionDefinitions={optionDefinitions} />
      <VariantDimensionsSection values={values} setValue={setValue} />
      <VariantMetadataSection values={values} setValue={setValue} />
      <VariantPricesSection values={values} setValue={setValue} priceKinds={priceKinds} taxRates={taxRates} />
      <VariantMediaSection values={values} setValue={setValue} />
    </div>
  )
}

export function VariantBasicsSection({ values, setValue, errors }: VariantSectionBaseProps) {
  const t = useT()
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
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center justify-between gap-2 rounded border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{t('catalog.variants.form.isDefaultLabel', 'Default variant')}</p>
            <p className="text-xs text-muted-foreground">{t('catalog.variants.form.isDefaultHint', 'Used in storefronts')}</p>
          </div>
          <Switch checked={values.isDefault} onCheckedChange={(next) => setValue('isDefault', next)} />
        </label>
        <label className="flex items-center justify-between gap-2 rounded border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{t('catalog.variants.form.isActiveLabel', 'Active')}</p>
            <p className="text-xs text-muted-foreground">{t('catalog.variants.form.isActiveHint', 'Inactive variants stay hidden')}</p>
          </div>
          <Switch checked={values.isActive !== false} onCheckedChange={(next) => setValue('isActive', next)} />
        </label>
      </div>
    </div>
  )
}

export function VariantOptionValuesSection({
  values,
  setValue,
  optionDefinitions,
  showHeading = true,
}: VariantOptionValuesSectionProps) {
  const t = useT()

  const handleOptionChange = React.useCallback(
    (code: string, next: string) => {
      setValue('optionValues', { ...(values.optionValues ?? {}), [code]: next })
    },
    [setValue, values.optionValues],
  )

  if (!optionDefinitions.length) return null

  return (
    <div className="space-y-3">
      {showHeading ? <h3 className="text-sm font-semibold">{t('catalog.variants.form.options', 'Option values')}</h3> : null}
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
  )
}

export function VariantDimensionsSection({ values, setValue, showHeading = true }: VariantDimensionsSectionProps) {
  const t = useT()
  const metadata = normalizeMetadata(values.metadata)
  const dimensionValues = normalizeDimensions(metadata)
  const weightValues = normalizeWeight(metadata)
  const dimensionUnitPlaceholder = t('catalog.variants.form.dimensionUnitPlaceholder', 'cm')
  const weightUnitPlaceholder = t('catalog.variants.form.weightUnitPlaceholder', 'kg')

  return (
    <div className="space-y-4">
      {showHeading ? <h3 className="text-sm font-semibold">{t('catalog.variants.form.dimensions', 'Dimensions & weight')}</h3> : null}
      <div className="grid gap-4 md:grid-cols-2">
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
          placeholder={dimensionUnitPlaceholder}
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
          placeholder={weightUnitPlaceholder}
          onChange={(value) => setValue('metadata', applyWeight(metadata, 'unit', value))}
        />
      </div>
    </div>
  )
}

export function VariantMetadataSection({
  values,
  setValue,
  showIntro = true,
  embedded = false,
}: VariantMetadataSectionProps) {
  const metadata = normalizeMetadata(values.metadata)
  const systemMetadata = React.useMemo(() => extractSystemMetadata(metadata), [metadata])
  const customMetadata = React.useMemo(() => stripSystemMetadata(metadata), [metadata])

  const handleMetadataChange = React.useCallback(
    (next: Record<string, unknown>) => {
      const merged: Record<string, unknown> = {}
      Object.entries(systemMetadata).forEach(([key, value]) => {
        merged[key] = value
      })
      Object.entries(next).forEach(([key, value]) => {
        merged[key] = value
      })
      setValue('metadata', merged)
    },
    [setValue, systemMetadata],
  )

  return (
    <MetadataEditor
      value={customMetadata}
      onChange={handleMetadataChange}
      title={showIntro ? undefined : ''}
      description={showIntro ? undefined : ''}
      embedded={embedded}
    />
  )
}

export function VariantPricesSection({
  values,
  setValue,
  priceKinds,
  taxRates,
  showHeader = true,
  embedded = false,
}: VariantPricesSectionProps) {
  const t = useT()

  const updatePrice = React.useCallback(
    (priceKindId: string, patch: Partial<VariantPriceDraft>) => {
      const prev = values.prices?.[priceKindId] ?? { priceKindId, amount: '', displayMode: 'excluding-tax' }
      setValue('prices', { ...values.prices, [priceKindId]: { ...prev, ...patch, priceKindId } })
    },
    [setValue, values.prices],
  )

  const containerClass = embedded ? 'space-y-4' : 'space-y-4 rounded-lg border p-4'

  return (
    <div className={containerClass}>
      {showHeader ? (
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t('catalog.variants.form.pricesLabel', 'Prices')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('catalog.variants.form.pricesHint', 'Populate list prices per price kind.')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded border px-3 py-2 text-sm"
              value={values.taxRateId ?? ''}
              onChange={(event) => setValue('taxRateId', event.target.value || null)}
            >
              <option value="">{t('catalog.variants.form.pricesTaxNone', 'No tax override')}</option>
              {taxRates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {formatTaxRateLabel(rate)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <select
            className="rounded border px-3 py-2 text-sm"
            value={values.taxRateId ?? ''}
            onChange={(event) => setValue('taxRateId', event.target.value || null)}
          >
            <option value="">{t('catalog.variants.form.pricesTaxNone', 'No tax override')}</option>
            {taxRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {formatTaxRateLabel(rate)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-3">
        {priceKinds.length ? (
          priceKinds.map((kind) => {
            const draft = values.prices?.[kind.id]
            return (
              <div key={kind.id} className="rounded bg-muted/40 p-3">
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
                  onChange={(event) => updatePrice(kind.id, { amount: event.target.value })}
                  placeholder="0.00"
                />
              </div>
            )
          })
        ) : (
          <p className="text-xs text-muted-foreground">{t('catalog.variants.form.pricesEmpty', 'No price kinds configured yet.')}</p>
        )}
      </div>
    </div>
  )
}

export function VariantMediaSection({ values, setValue, showLabel = true }: VariantMediaSectionProps) {
  const t = useT()
  return (
    <div className="space-y-2">
      {showLabel ? <Label>{t('catalog.variants.form.media', 'Media')}</Label> : null}
      <ProductMediaManager
        entityId={E.catalog.catalog_product_variant}
        draftRecordId={values.mediaDraftId}
        items={Array.isArray(values.mediaItems) ? values.mediaItems : []}
        defaultMediaId={values.defaultMediaId}
        onItemsChange={(next) => setValue('mediaItems', next)}
        onDefaultChange={(next) => setValue('defaultMediaId', next)}
      />
    </div>
  )
}

function DimensionInput({
  label,
  value,
  onChange,
  placeholder = '0',
}: {
  label: string
  value: string | number | undefined
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      <Input value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
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

function stripSystemMetadata(metadata: Record<string, any>) {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'dimensions' || key === 'weight') continue
    copy[key] = value
  }
  return copy
}

function extractSystemMetadata(metadata: Record<string, any>) {
  const system: Record<string, unknown> = {}
  if (metadata.dimensions) system.dimensions = metadata.dimensions
  if (metadata.weight) system.weight = metadata.weight
  return system
}
