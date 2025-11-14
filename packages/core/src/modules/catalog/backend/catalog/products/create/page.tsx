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
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
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
import { CATALOG_PRODUCT_TYPES } from '../../../../data/types'

type ProductFormTabId = 'general' | 'attributes' | 'variants' | 'subproducts' | 'customOptions'
type CustomOptionChoice = NonNullable<CustomOptionDraft['choices']>[number]

type CreateProductFormValues = {
  name: string
  description?: string
  code?: string
  productType: CatalogProductType
  isActive: boolean
  isConfigurable: boolean
  primaryCurrencyCode?: string
  defaultUnit?: string
  basePriceNet?: string
  basePriceGross?: string
  taxRate?: string
  attributeSchemaId?: string | null
  attributeSchema?: CatalogAttributeSchema | null
  attributeSchemaResolved?: CatalogAttributeSchema | null
  attributeValues?: Record<string, unknown>
  variantDrafts: VariantDraft[]
  subproducts: SubproductDraft[]
  customOptions: CustomOptionDraft[]
}

export default function CreateCatalogProductPage() {
  const t = useT()
  const router = useRouter()
  const scope = useOrganizationScopeDetail()
  const [activeTab, setActiveTab] = React.useState<ProductFormTabId>('general')

  const initialValues = React.useMemo<CreateProductFormValues>(
    () => ({
      name: '',
      description: '',
      code: '',
      productType: 'simple',
      isActive: true,
      isConfigurable: false,
      primaryCurrencyCode: 'USD',
      defaultUnit: '',
      basePriceNet: '',
      basePriceGross: '',
      taxRate: '',
      attributeSchemaId: null,
      attributeSchema: null,
      attributeSchemaResolved: null,
      attributeValues: {},
      variantDrafts: [],
      subproducts: [],
      customOptions: [],
    }),
    [],
  )

  const productTypeOptions = React.useMemo(
    () =>
      CATALOG_PRODUCT_TYPES.map((type: CatalogProductType) => ({
        value: type,
        label: t(`catalog.products.types.${type}`, type),
      })),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('catalog.products.form.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('catalog.products.form.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'code',
      label: t('catalog.products.form.code', 'Code'),
      type: 'text',
    },
    {
      id: 'productType',
      label: t('catalog.products.form.productType', 'Product type'),
      type: 'select',
      options: productTypeOptions,
      required: true,
    },
    {
      id: 'isActive',
      label: t('catalog.products.form.isActive', 'Active'),
      type: 'checkbox',
    },
    {
      id: 'isConfigurable',
      label: t('catalog.products.form.isConfigurable', 'Configurable'),
      type: 'checkbox',
    },
    {
      id: 'primaryCurrencyCode',
      label: t('catalog.products.form.currency', 'Primary currency'),
      type: 'text',
    },
    {
      id: 'defaultUnit',
      label: t('catalog.products.form.unit', 'Default unit'),
      type: 'text',
    },
  ], [productTypeOptions, t])

  const generalFieldIds = React.useMemo(
    () => ['name', 'description', 'code', 'productType', 'isActive', 'isConfigurable', 'primaryCurrencyCode', 'defaultUnit'],
    [],
  )

  const tabs = React.useMemo<ReadonlyArray<{ id: ProductFormTabId; label: string }>>(
    () => [
      { id: 'general', label: t('catalog.products.form.general', 'General') },
      { id: 'attributes', label: t('catalog.products.create.tabs.attributes', 'Attributes') },
      { id: 'variants', label: t('catalog.products.form.variants', 'Variants') },
      { id: 'subproducts', label: t('catalog.products.create.tabs.subproducts', 'Subproducts') },
      { id: 'customOptions', label: t('catalog.products.form.options', 'Options') },
    ],
    [t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const list: CrudFormGroup[] = []
    if (activeTab === 'general') {
      list.push({
        id: 'generalFields',
        title: t('catalog.products.form.general', 'General'),
        column: 1,
        fields: generalFieldIds,
      })
      list.push({
        id: 'pricing',
        title: t('catalog.products.form.pricing', 'Pricing'),
        column: 1,
        component: (ctx) => <BasePricingSection values={ctx.values} setValue={ctx.setValue} />,
      })
    } else if (activeTab === 'attributes') {
      list.push({
        id: 'attributes',
        title: t('catalog.products.create.tabs.attributes', 'Attributes'),
        column: 1,
        component: (ctx) => (
          <ProductAttributeSchemaPanel values={ctx.values} setValue={ctx.setValue} />
        ),
      })
    } else if (activeTab === 'variants') {
      list.push({
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
            disabled={(ctx.values.productType as CatalogProductType) !== 'configurable'}
          />
        ),
      })
    } else if (activeTab === 'subproducts') {
      list.push({
        id: 'subproducts',
        title: t('catalog.products.create.tabs.subproducts', 'Subproducts'),
        column: 1,
        component: (ctx) => (
          <ProductSubproductsPanel
            values={ctx.values}
            setValue={ctx.setValue}
            productType={(ctx.values.productType as CatalogProductType) ?? 'simple'}
          />
        ),
      })
    } else if (activeTab === 'customOptions') {
      list.push({
        id: 'customOptions',
        title: t('catalog.products.form.options', 'Options'),
        column: 1,
        component: (ctx) => (
          <ProductCustomOptionsPanel values={ctx.values} setValue={ctx.setValue} />
        ),
      })
    }
    list.push({
      id: 'customFields',
      column: 2,
      kind: 'customFields',
      title: t('entities.customFields.title', 'Custom fields'),
    })
    return list
  }, [activeTab, generalFieldIds, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<CreateProductFormValues>
          title={t('catalog.products.actions.create', 'Create')}
          backHref="/backend/catalog/products"
          fields={fields}
          groups={groups}
          contentHeader={(
            <ProductFormTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(id) => setActiveTab(id)}
            />
          )}
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
            const basePayload: Record<string, unknown> = {
              organizationId,
              tenantId,
              name: formValues.name,
              description: formValues.description?.trim() ?? null,
              code: formValues.code?.trim() ?? null,
              productType: formValues.productType,
              isActive: formValues.isActive !== false,
              isConfigurable: formValues.isConfigurable === true,
              primaryCurrencyCode: formValues.primaryCurrencyCode?.trim() || null,
              defaultUnit: formValues.defaultUnit?.trim() || null,
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
            const currencyCode =
              typeof formValues.primaryCurrencyCode === 'string' &&
              formValues.primaryCurrencyCode.trim().length
                ? formValues.primaryCurrencyCode.trim()
                : null

            const hasBasePrice =
              Boolean(formValues.basePriceNet && formValues.basePriceNet.trim().length) ||
              Boolean(formValues.basePriceGross && formValues.basePriceGross.trim().length)
            if (hasBasePrice) {
              if (!currencyCode) {
                throw createCrudFormError(
                  t('catalog.products.create.pricing.currencyRequired', 'Provide a currency to save pricing.'),
                  { primaryCurrencyCode: t('catalog.products.create.pricing.currencyRequired', 'Provide a currency to save pricing.') },
                )
              }
              await createCrud('catalog/prices', {
                organizationId,
                tenantId,
                productId,
                currencyCode,
                unitPriceNet: formValues.basePriceNet?.trim() || null,
                unitPriceGross: formValues.basePriceGross?.trim() || null,
                taxRate: formValues.taxRate?.trim() || null,
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
                if (!currencyCode) {
                  throw createCrudFormError(
                    t('catalog.products.create.pricing.currencyRequired', 'Provide a currency to save pricing.'),
                    { primaryCurrencyCode: t('catalog.products.create.pricing.currencyRequired', 'Provide a currency to save pricing.') },
                  )
                }
                await createCrud('catalog/prices', {
                  organizationId,
                  tenantId,
                  productId,
                  variantId,
                  currencyCode,
                  unitPriceNet: draft.priceNet?.trim() || null,
                  unitPriceGross: draft.priceGross?.trim() || null,
                  taxRate: draft.taxRate?.trim() || formValues.taxRate?.trim() || null,
                })
              }
            }

            const optionDrafts = Array.isArray(formValues.customOptions)
              ? (formValues.customOptions as CustomOptionDraft[])
              : []
            for (const [index, option] of optionDrafts.entries()) {
              if (!option.label?.trim()) continue
              const code = option.code?.trim() || slugify(option.label)
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
                            value: choice.value.trim(),
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

type TabsProps = {
  tabs: ReadonlyArray<{ id: ProductFormTabId; label: string }>
  activeTab: ProductFormTabId
  onTabChange: (id: ProductFormTabId) => void
}

function ProductFormTabs({ tabs, activeTab, onTabChange }: TabsProps) {
  const t = useT()
  return (
    <div className="border-b border-border">
      <nav
        className="flex items-center gap-6 text-sm"
        role="tablist"
        aria-label={t('catalog.products.create.tabs.label', 'Product sections')}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab}
            className={`relative -mb-px border-b-2 px-0 pb-3 pt-2 font-medium transition-colors ${
              tab.id === activeTab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

type BasePricingSectionProps = Pick<CrudFormGroupComponentProps, 'values' | 'setValue'>

function BasePricingSection({ values, setValue }: BasePricingSectionProps) {
  const t = useT()
  const typedValues = values as CreateProductFormValues
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide">
          {t('catalog.products.create.pricing.net', 'Net price')}
        </label>
        <Input
          type="number"
          value={typedValues.basePriceNet ?? ''}
          onChange={(event) => setValue('basePriceNet', event.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide">
          {t('catalog.products.create.pricing.gross', 'Gross price')}
        </label>
        <Input
          type="number"
          value={typedValues.basePriceGross ?? ''}
          onChange={(event) => setValue('basePriceGross', event.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide">
          {t('catalog.products.create.pricing.taxRate', 'Tax rate')}
        </label>
        <Input
          type="number"
          value={typedValues.taxRate ?? ''}
          onChange={(event) => setValue('taxRate', event.target.value)}
        />
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
    .map((entry, index) => ({
      childProductId: entry.childProductId,
      relationType: entry.relationType ?? 'bundle',
      isRequired: entry.isRequired ?? false,
      minQuantity:
        typeof entry.minQuantity === 'number' ? entry.minQuantity : null,
      maxQuantity:
        typeof entry.maxQuantity === 'number' ? entry.maxQuantity : null,
      position: index,
    }))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}
