"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  ProductAttributeSchemaPanel,
  ProductVariantsPanel,
  ProductSubproductsPanel,
  ProductCustomOptionsPanel,
  type VariantDraft,
  type SubproductDraft,
  type CustomOptionDraft,
} from '../../../../components/products'
import type {
  CatalogAttributeSchema,
  CatalogProductType,
} from '../../../../data/types'
import {
  CATALOG_CONFIGURABLE_PRODUCT_TYPES,
  CATALOG_PRODUCT_TYPES,
} from '../../../../data/types'

type CustomOptionChoice = NonNullable<CustomOptionDraft['choices']>[number]
type DictionaryOption = { value: string; label: string }

type PriceDraft = {
  id: string
  kind: 'list' | 'sale' | 'tier' | 'custom'
  currencyCode?: string
  unitPriceNet?: string
  unitPriceGross?: string
  taxRate?: string
  minQuantity?: string
  maxQuantity?: string
  startsAt?: string
  endsAt?: string
}

type CreateProductFormValues = {
  title: string
  subtitle?: string
  handle?: string
  description?: string
  sku?: string
  productType: CatalogProductType
  isActive: boolean
  primaryCurrencyCode?: string
  defaultUnit?: string
  priceEntries: PriceDraft[]
  attributeSchemaId?: string | null
  attributeSchema?: CatalogAttributeSchema | null
  attributeSchemaResolved?: CatalogAttributeSchema | null
  attributeValues?: Record<string, unknown>
  optionSchemaId?: string | null
  variantDrafts: VariantDraft[]
  subproducts: SubproductDraft[]
  customOptions: CustomOptionDraft[]
}

export default function CreateCatalogProductPage() {
  const t = useT()
  const router = useRouter()
  const scope = useOrganizationScopeDetail()

  const initialValues = React.useMemo<CreateProductFormValues>(
    () => ({
      title: '',
      subtitle: '',
      handle: '',
      description: '',
      sku: '',
      productType: 'simple',
      isActive: true,
      primaryCurrencyCode: '',
      defaultUnit: '',
      priceEntries: [],
      attributeSchemaId: null,
      attributeSchema: null,
      attributeSchemaResolved: null,
      attributeValues: {},
      optionSchemaId: null,
      variantDrafts: [],
      subproducts: [],
      customOptions: [],
    }),
    [],
  )

  const {
    options: currencyOptions,
    loading: currencyLoading,
    error: currencyError,
  } = useDictionaryOptions('currency')
  const {
    options: unitOptions,
    loading: unitLoading,
    error: unitError,
  } = useDictionaryOptions('unit')

  const productTypeOptions = React.useMemo(
    () =>
      CATALOG_PRODUCT_TYPES.map((type: CatalogProductType) => ({
        value: type,
        label: t(`catalog.products.types.${type}`, type),
      })),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => {
    const handleField: CrudField = {
      id: 'handle',
      label: t('catalog.products.form.handle', 'Handle'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <HandleInputField
          value={typeof value === 'string' ? value : ''}
          onChange={(next) => setValue(next)}
        />
      ),
    }
    return [
      {
        id: 'title',
        label: t('catalog.products.form.title', 'Title'),
        type: 'text',
        required: true,
      },
      {
        id: 'subtitle',
        label: t('catalog.products.form.subtitle', 'Subtitle'),
        type: 'text',
      },
      handleField,
      {
        id: 'description',
        label: t('catalog.products.form.description', 'Description'),
        type: 'textarea',
      },
      {
        id: 'productType',
        label: t('catalog.products.form.productType', 'Product type'),
        type: 'select',
        options: productTypeOptions,
        required: true,
      },
      {
        id: 'sku',
        label: t('catalog.products.form.sku', 'SKU'),
        type: 'text',
      },
      {
        id: 'isActive',
        label: t('catalog.products.form.isActive', 'Active'),
        type: 'checkbox',
      },
    ]
  }, [productTypeOptions, t])

  const generalFieldIds = React.useMemo(
    () => ['title', 'subtitle', 'handle', 'description', 'productType', 'sku', 'isActive'],
    [],
  )

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'generalFields',
      title: t('catalog.products.form.general', 'General'),
      column: 1,
      fields: generalFieldIds,
    },
    {
      id: 'options',
      title: t('catalog.products.form.options', 'Options'),
      column: 1,
      component: (ctx) => (
        <ProductCustomOptionsPanel values={ctx.values} setValue={ctx.setValue} />
      ),
    },
    {
      id: 'variants',
      title: t('catalog.products.form.variants', 'Variants'),
      column: 1,
      component: (ctx) => (
        <ProductVariantsPanel
          values={ctx.values}
          setValue={ctx.setValue}
          currencyCode={
            typeof ctx.values.primaryCurrencyCode === 'string'
              ? ctx.values.primaryCurrencyCode
              : null
          }
          attributeSchema={
            (ctx.values.attributeSchemaResolved as CatalogAttributeSchema | null) ??
            (ctx.values.attributeSchema as CatalogAttributeSchema | null) ??
            null
          }
          disabled={!isConfigurableProductType(ctx.values.productType as CatalogProductType)}
        />
      ),
    },
    {
      id: 'pricing',
      title: t('catalog.products.form.pricing', 'Pricing'),
      column: 2,
      component: (ctx) => (
        <ProductPricingPanel
          values={ctx.values as CreateProductFormValues}
          setValue={ctx.setValue}
          currencyOptions={currencyOptions}
          currencyError={currencyError}
          currencyLoading={currencyLoading}
          unitOptions={unitOptions}
          unitError={unitError}
          unitLoading={unitLoading}
        />
      ),
    },
    {
      id: 'attributes',
      title: t('catalog.products.create.tabs.attributes', 'Attributes'),
      column: 2,
      component: (ctx) => (
        <ProductAttributeSchemaPanel values={ctx.values} setValue={ctx.setValue} />
      ),
    },
    {
      id: 'subproducts',
      title: t('catalog.products.create.tabs.subproducts', 'Subproducts'),
      column: 2,
      component: (ctx) => (
        <ProductSubproductsPanel
          values={ctx.values}
          setValue={ctx.setValue}
          productType={(ctx.values.productType as CatalogProductType) ?? 'simple'}
        />
      ),
    },
    {
      id: 'customFields',
      column: 2,
      kind: 'customFields',
      title: t('entities.customFields.title', 'Custom fields'),
    },
  ], [
    currencyError,
    currencyLoading,
    currencyOptions,
    generalFieldIds,
    t,
    unitError,
    unitLoading,
    unitOptions,
  ])

  return (
    <Page>
      <PageBody>
        <CrudForm<CreateProductFormValues>
          title={t('catalog.products.actions.create', 'Create')}
          backHref="/backend/catalog/products"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          entityId={E.catalog.catalog_product}
          submitLabel={t('catalog.products.actions.create', 'Create')}
          cancelHref="/backend/catalog/products"
          onSubmit={async (formValues) => {
            const organizationId = scope.organizationId
            const tenantId = scope.tenantId
            if (!organizationId || !tenantId) {
              throw createCrudFormError(
                t('catalog.products.create.errors.scope', 'Select an organization before creating products.'),
              )
            }
            const trimmedTitle = formValues.title?.trim()
            if (!trimmedTitle) {
              throw createCrudFormError(
                t('catalog.products.create.errors.titleRequired', 'Provide a product title.'),
                { title: t('catalog.products.create.errors.titleRequired', 'Provide a product title.') },
              )
            }
            const productType = (formValues.productType as CatalogProductType) ?? 'simple'
            const primaryCurrencyCode = sanitizeCurrencyCode(formValues.primaryCurrencyCode)
            const basePayload: Record<string, unknown> = {
              organizationId,
              tenantId,
              title: trimmedTitle,
              subtitle: sanitizeNullable(formValues.subtitle),
              handle: normalizeHandle(formValues.handle),
              description: sanitizeNullable(formValues.description),
              sku: sanitizeNullable(formValues.sku),
              productType,
              isActive: formValues.isActive !== false,
              isConfigurable: isConfigurableProductType(productType),
              primaryCurrencyCode,
              defaultUnit: sanitizeNullable(formValues.defaultUnit),
              optionSchemaId: formValues.optionSchemaId ?? null,
              attributeSchemaId: formValues.attributeSchemaId ?? null,
              attributeSchema: formValues.attributeSchema ?? null,
              attributeValues: formValues.attributeValues ?? {},
              subproducts: sanitizeSubproducts(formValues.subproducts),
            }
            const customFields = collectCustomFieldValues(formValues)
            if (Object.keys(customFields).length) {
              basePayload.customFields = customFields
            }
            const productResponse = await createCrud<{ id?: string; productId?: string }>(
              'catalog/products',
              basePayload,
            )
            const productId =
              productResponse.result?.id ?? productResponse.result?.productId ?? null
            if (!productId) {
              throw createCrudFormError(
                t('catalog.products.create.errors.missingId', 'Product identifier missing after create.'),
              )
            }

            const priceEntries = Array.isArray(formValues.priceEntries)
              ? (formValues.priceEntries as PriceDraft[])
              : []
            const priceDrafts = priceEntries.filter(
              (entry) =>
                Boolean(entry?.unitPriceNet && entry.unitPriceNet.trim().length) ||
                Boolean(entry?.unitPriceGross && entry.unitPriceGross.trim().length),
            )
            for (const entry of priceDrafts) {
              const entryCurrency =
                sanitizeCurrencyCode(entry.currencyCode) ?? primaryCurrencyCode
              if (!entryCurrency) {
                throw createCrudFormError(
                  t('catalog.products.create.pricing.currencyRequired', 'Provide a currency to save pricing.'),
                  {
                    primaryCurrencyCode: t(
                      'catalog.products.create.pricing.currencyRequired',
                      'Provide a currency to save pricing.',
                    ),
                  },
                )
              }
              await createCrud('catalog/prices', {
                organizationId,
                tenantId,
                productId,
                currencyCode: entryCurrency,
                kind: entry.kind ?? 'list',
                unitPriceNet: normalizeNumericInput(entry.unitPriceNet),
                unitPriceGross: normalizeNumericInput(entry.unitPriceGross),
                taxRate: normalizeNumericInput(entry.taxRate),
                minQuantity: normalizeIntegerInput(entry.minQuantity),
                maxQuantity: normalizeIntegerInput(entry.maxQuantity),
                startsAt: entry.startsAt?.trim() || undefined,
                endsAt: entry.endsAt?.trim() || undefined,
              })
            }

            const variantDrafts = Array.isArray(formValues.variantDrafts)
              ? (formValues.variantDrafts as VariantDraft[])
              : []
            const filteredVariants = variantDrafts.filter((draft) => {
              const hasName = Boolean(draft?.name?.trim())
              const hasSku = Boolean(draft?.sku?.trim())
              const hasAttributes =
                draft?.attributeValues && Object.keys(draft.attributeValues).length > 0
              return hasName || hasSku || hasAttributes
            })
            for (const draft of filteredVariants) {
              const variantPayload: Record<string, unknown> = {
                organizationId,
                tenantId,
                productId,
                name: draft.name?.trim() || null,
                sku: draft.sku?.trim() || null,
                isDefault: draft.isDefault ?? false,
                attributeValues: draft.attributeValues ?? undefined,
              }
              const variantResponse = await createCrud<{ id?: string; variantId?: string }>(
                'catalog/variants',
                variantPayload,
              )
              const variantId =
                variantResponse.result?.id ?? variantResponse.result?.variantId ?? null
              if (
                variantId &&
                (draft.priceNet?.trim().length || draft.priceGross?.trim().length)
              ) {
                if (!primaryCurrencyCode) {
                  throw createCrudFormError(
                    t('catalog.products.create.pricing.currencyRequired', 'Provide a currency to save pricing.'),
                    {
                      primaryCurrencyCode: t(
                        'catalog.products.create.pricing.currencyRequired',
                        'Provide a currency to save pricing.',
                      ),
                    },
                  )
                }
                await createCrud('catalog/prices', {
                  organizationId,
                  tenantId,
                  productId,
                  variantId,
                  currencyCode: primaryCurrencyCode,
                  unitPriceNet: normalizeNumericInput(draft.priceNet),
                  unitPriceGross: normalizeNumericInput(draft.priceGross),
                  taxRate: normalizeNumericInput(draft.taxRate),
                })
              }
            }

            const optionDrafts = Array.isArray(formValues.customOptions)
              ? (formValues.customOptions as CustomOptionDraft[])
              : []
            for (const [index, option] of optionDrafts.entries()) {
              if (!option.label?.trim()) continue
              const code = normalizeOptionCode(option.code?.trim() || option.label)
              if (!code) continue
              await createCrud('catalog/options', {
                organizationId,
                tenantId,
                productId,
                label: option.label.trim(),
                code,
                description: option.description?.trim() || null,
                inputType: option.inputType,
                isRequired: option.isRequired ?? false,
                isMultiple: option.isMultiple ?? false,
                position: index,
                inputConfig:
                  option.inputType === 'select'
                    ? {
                        choices: (Array.isArray(option.choices) ? option.choices : ([] as CustomOptionChoice[]))
                          .filter((choice: CustomOptionChoice) => choice.value.trim())
                          .map((choice: CustomOptionChoice) => ({
                            value: normalizeOptionCode(choice.value) ?? choice.value.trim(),
                            label: choice.label?.trim() || choice.value.trim(),
                          })),
                      }
                    : undefined,
              })
            }

            flash(t('catalog.products.flash.created', 'Product created'), 'success')
            router.push('/backend/catalog/products')
          }}
        />
      </PageBody>
    </Page>
  )
}

type HandleInputFieldProps = {
  value: string
  onChange: (value: string) => void
}

function HandleInputField({ value, onChange }: HandleInputFieldProps) {
  const t = useT()
  const preview = value?.trim().length ? `/${value}` : '/handle'
  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(event) => onChange(formatHandleDraft(event.target.value))}
        placeholder={t('catalog.products.form.handlePlaceholder', 'e.g., summer-sneaker')}
      />
      <p className="text-xs text-muted-foreground">
        {t('catalog.products.form.handlePreview', 'Handle: ')}
        <span className="font-mono">{preview}</span>
      </p>
    </div>
  )
}

type ProductPricingPanelProps = {
  values: CreateProductFormValues
  setValue: CrudFormGroupComponentProps['setValue']
  currencyOptions: DictionaryOption[]
  currencyLoading: boolean
  currencyError: string | null
  unitOptions: DictionaryOption[]
  unitLoading: boolean
  unitError: string | null
}

function ProductPricingPanel({
  values,
  setValue,
  currencyOptions,
  currencyLoading,
  currencyError,
  unitOptions,
  unitLoading,
  unitError,
}: ProductPricingPanelProps) {
  const t = useT()
  const priceEntries = Array.isArray(values.priceEntries)
    ? (values.priceEntries as PriceDraft[])
    : []
  const updateEntries = (next: PriceDraft[]) => setValue('priceEntries', next)
  const addEntry = () => {
    updateEntries([...priceEntries, createPriceDraft(values.primaryCurrencyCode)])
  }
  const updateEntry = (id: string, patch: Partial<PriceDraft>) => {
    updateEntries(priceEntries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }
  const removeEntry = (id: string) => {
    updateEntries(priceEntries.filter((entry) => entry.id !== id))
  }
  const primaryCurrencyValue =
    typeof values.primaryCurrencyCode === 'string' ? values.primaryCurrencyCode : ''
  const defaultUnitValue = typeof values.defaultUnit === 'string' ? values.defaultUnit : ''

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.form.currency', 'Primary currency')}
          </label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={primaryCurrencyValue}
            onChange={(event) => setValue('primaryCurrencyCode', event.target.value)}
            disabled={currencyLoading}
          >
            <option value="">
              {t('catalog.products.create.pricing.currencyPlaceholder', 'Select currency')}
            </option>
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {currencyError ? <p className="text-xs text-red-600">{currencyError}</p> : null}
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.form.unit', 'Default unit')}
          </label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={defaultUnitValue}
            onChange={(event) => setValue('defaultUnit', event.target.value)}
            disabled={unitLoading}
          >
            <option value="">
              {t('catalog.products.create.pricing.unitPlaceholder', 'Select unit')}
            </option>
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {unitError ? <p className="text-xs text-red-600">{unitError}</p> : null}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {t('catalog.products.create.pricing.entriesTitle', 'Price entries')}
        </div>
        <Button type="button" variant="outline" onClick={addEntry}>
          {t('catalog.products.create.pricing.addPrice', 'Add price')}
        </Button>
      </div>
      {priceEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.products.create.pricing.empty', 'No prices yet.')}
        </p>
      ) : (
        <div className="space-y-3">
          {priceEntries.map((entry) => (
            <PriceEntryCard
              key={entry.id}
              entry={entry}
              currencyOptions={currencyOptions}
              currencyLoading={currencyLoading}
              onChange={(patch) => updateEntry(entry.id, patch)}
              onRemove={() => removeEntry(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type PriceEntryCardProps = {
  entry: PriceDraft
  onChange: (patch: Partial<PriceDraft>) => void
  onRemove: () => void
  currencyOptions: DictionaryOption[]
  currencyLoading: boolean
}

function PriceEntryCard({
  entry,
  onChange,
  onRemove,
  currencyOptions,
  currencyLoading,
}: PriceEntryCardProps) {
  const t = useT()
  const priceKinds: Array<{ value: PriceDraft['kind']; label: string }> = [
    { value: 'list', label: t('catalog.products.create.pricing.kind.list', 'List') },
    { value: 'sale', label: t('catalog.products.create.pricing.kind.sale', 'Sale') },
    { value: 'tier', label: t('catalog.products.create.pricing.kind.tier', 'Tier') },
    { value: 'custom', label: t('catalog.products.create.pricing.kind.custom', 'Custom') },
  ]
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.kindLabel', 'Kind')}
          </label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={entry.kind ?? 'list'}
            onChange={(event) => onChange({ kind: event.target.value as PriceDraft['kind'] })}
          >
            {priceKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.currencyLabel', 'Currency')}
          </label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={entry.currencyCode ?? ''}
            onChange={(event) => onChange({ currencyCode: event.target.value || undefined })}
            disabled={currencyLoading}
          >
            <option value="">
              {t('catalog.products.create.pricing.usePrimaryCurrency', 'Use primary currency')}
            </option>
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.net', 'Net price')}
          </label>
          <Input
            type="number"
            value={entry.unitPriceNet ?? ''}
            onChange={(event) => onChange({ unitPriceNet: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.gross', 'Gross price')}
          </label>
          <Input
            type="number"
            value={entry.unitPriceGross ?? ''}
            onChange={(event) => onChange({ unitPriceGross: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.taxRate', 'Tax rate')}
          </label>
          <Input
            type="number"
            value={entry.taxRate ?? ''}
            onChange={(event) => onChange({ taxRate: event.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.minQty', 'Min qty')}
          </label>
          <Input
            type="number"
            value={entry.minQuantity ?? ''}
            onChange={(event) => onChange({ minQuantity: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.maxQty', 'Max qty')}
          </label>
          <Input
            type="number"
            value={entry.maxQuantity ?? ''}
            onChange={(event) => onChange({ maxQuantity: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.startsAt', 'Starts at')}
          </label>
          <Input
            type="date"
            value={entry.startsAt ?? ''}
            onChange={(event) => onChange({ startsAt: event.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.endsAt', 'Ends at')}
          </label>
          <Input
            type="date"
            value={entry.endsAt ?? ''}
            onChange={(event) => onChange({ endsAt: event.target.value })}
          />
        </div>
        <div className="flex items-end justify-end">
          <Button type="button" variant="ghost" onClick={onRemove}>
            {t('catalog.products.create.remove', 'Remove')}
          </Button>
        </div>
      </div>
    </div>
  )
}

type SubproductPayload = {
  childProductId: string
  relationType: 'bundle' | 'grouped'
  isRequired: boolean
  minQuantity: number | null
  maxQuantity: number | null
  position: number
}

function sanitizeSubproducts(entries: SubproductDraft[] | undefined): SubproductPayload[] {
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => entry && entry.childProductId)
    .map((entry, index) => {
      const relationType: SubproductPayload['relationType'] =
        entry.relationType === 'grouped' ? 'grouped' : 'bundle'
      return {
        childProductId: entry.childProductId,
        relationType,
        isRequired: entry.isRequired ?? false,
        minQuantity: typeof entry.minQuantity === 'number' ? entry.minQuantity : null,
        maxQuantity: typeof entry.maxQuantity === 'number' ? entry.maxQuantity : null,
        position: index,
      }
    })
}

function formatHandleDraft(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
}

function normalizeHandle(value?: string | null): string | null {
  if (!value) return null
  const normalized = formatHandleDraft(value)
  return normalized.length ? normalized : null
}

function sanitizeNullable(value?: string | null): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function sanitizeCurrencyCode(value?: string | null): string | null {
  const normalized = sanitizeNullable(value)
  return normalized ? normalized.toUpperCase() : null
}

function normalizeOptionCode(value?: string | null): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
  return normalized.length ? normalized : null
}

function normalizeNumericInput(value?: string): number | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = value.toString().trim()
  if (!trimmed.length) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeIntegerInput(value?: string): number | undefined {
  const parsed = normalizeNumericInput(value)
  if (parsed === undefined) return undefined
  const intVal = Math.trunc(parsed)
  return Number.isFinite(intVal) ? intVal : undefined
}

function createPriceDraft(baseCurrency?: string | null): PriceDraft {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `price_${Math.random().toString(36).slice(2, 10)}`,
    kind: 'list',
    currencyCode: baseCurrency ?? undefined,
    unitPriceNet: '',
    unitPriceGross: '',
    taxRate: '',
    minQuantity: '',
    maxQuantity: '',
    startsAt: '',
    endsAt: '',
  }
}

function isConfigurableProductType(type?: CatalogProductType | string | null): boolean {
  if (!type) return false
  return (CATALOG_CONFIGURABLE_PRODUCT_TYPES as readonly string[]).includes(
    type as CatalogProductType,
  )
}

function useDictionaryOptions(key: 'currency' | 'unit') {
  const t = useT()
  const [options, setOptions] = React.useState<DictionaryOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiCall<{ entries?: Array<{ value?: string; label?: string }> }>(
        `/api/catalog/dictionaries/${key}`,
      )
      if (response.ok && Array.isArray(response.result?.entries)) {
        const mapped = response.result.entries
          .map((entry) => {
            const value =
              typeof entry.value === 'string' && entry.value.trim().length
                ? entry.value.trim()
                : null
            if (!value) return null
            const label =
              typeof entry.label === 'string' && entry.label.trim().length
                ? entry.label.trim()
                : value
            return { value, label }
          })
          .filter((entry): entry is DictionaryOption => entry !== null)
        setOptions(mapped)
      } else {
        throw new Error('Dictionary load failed')
      }
    } catch (err) {
      console.error(`[catalog.dictionaries.${key}]`, err)
      const fallback =
        key === 'currency'
          ? t('catalog.products.create.pricing.currencyLoadError', 'Unable to load currencies.')
          : t('catalog.products.create.pricing.unitLoadError', 'Unable to load units.')
      setOptions([])
      setError(fallback)
    } finally {
      setLoading(false)
    }
  }, [key, t])

  React.useEffect(() => {
    load().catch(() => {})
  }, [load])

  return { options, loading, error }
}
