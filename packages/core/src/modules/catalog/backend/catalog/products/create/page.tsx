"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, ImagePlus, Layers, Plus, UploadCloud, X } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { cn } from '@open-mercato/shared/lib/utils'
import { DictionaryEntrySelect, type DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  ProductAttributeSchemaPanel,
  ProductVariantsPanel,
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

type ProductWizardStep = 'basics' | 'organize' | 'variants'

type MediaDraft = {
  id: string
  file: File
  name: string
  size: number
  previewUrl: string
}

type OrganizerDraft = {
  categories: string[]
  tags: string[]
  salesChannels: string[]
}

const COMING_SOON_PRODUCT_TYPES = new Set<CatalogProductType>(['bundle', 'grouped'])

type CatalogDictionarySelectConfig = {
  labels: DictionarySelectLabels
  fetchOptions: () => Promise<Array<{ value: string; label: string; color: string | null; icon: string | null }>>
  createOption?: (input: {
    value: string
    label?: string
    color?: string | null
    icon?: string | null
  }) => Promise<{ value: string; label: string; color: string | null; icon: string | null } | null>
  appearanceLabels: {
    colorLabel: string
    colorHelp: string
    colorClearLabel: string
    iconLabel: string
    iconPlaceholder: string
    iconPickerTriggerLabel: string
    iconSearchPlaceholder: string
    iconSearchEmptyLabel: string
    iconSuggestionsLabel: string
    iconClearLabel: string
    previewEmptyLabel: string
  }
  manageHref: string
  error: string | null
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
  mediaDrafts: MediaDraft[]
  organizer: OrganizerDraft
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
      priceEntries: [createPriceDraft()],
      mediaDrafts: [],
      organizer: { categories: [], tags: [], salesChannels: [] },
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

  const productTypeOptions = React.useMemo(
    () =>
      CATALOG_PRODUCT_TYPES.map((type: CatalogProductType) => ({
        value: type,
        label: t(`catalog.products.types.${type}`, type),
      })),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => [], [])

  const currencyDictionary = useCatalogDictionarySelect('currency')
  const unitDictionary = useCatalogDictionarySelect('unit')
  const [activeStep, setActiveStep] = React.useState<ProductWizardStep>('basics')

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'wizard',
        column: 1,
        component: (ctx) => (
          <ProductCreateWizard
            values={ctx.values as CreateProductFormValues}
            setValue={ctx.setValue}
            productTypeOptions={productTypeOptions}
            activeStep={activeStep}
            onStepChange={setActiveStep}
            currencyDictionary={currencyDictionary}
            unitDictionary={unitDictionary}
            errors={ctx.errors as Record<string, string>}
          />
        ),
      },
      {
        id: 'attributeSchemaSidebar',
        column: 2,
        title: t('catalog.products.create.sections.attributeSchema.sidebarTitle', 'Attribute schema'),
        component: (ctx) => (
          <AttributeSchemaSidebar
            values={ctx.values as CreateProductFormValues}
            setValue={ctx.setValue}
          />
        ),
      },
    ],
    [activeStep, currencyDictionary, productTypeOptions, t, unitDictionary],
  )

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

            const mediaDrafts = Array.isArray(formValues.mediaDrafts)
              ? (formValues.mediaDrafts as MediaDraft[])
              : []
            if (mediaDrafts.length) {
              const { uploaded, failed } = await uploadProductMediaDrafts(
                mediaDrafts,
                E.catalog.catalog_product,
                productId,
              )
              if (failed > 0) {
                flash(
                  t(
                    'catalog.products.create.media.partialFailure',
                    'Uploaded {{uploaded}} file(s); {{failed}} failed. You can retry from the product detail page.',
                    { uploaded, failed },
                  ),
                  'warning',
                )
              }
            }

            flash(t('catalog.products.flash.created', 'Product created'), 'success')
            router.push('/backend/catalog/products')
          }}
        />
      </PageBody>
    </Page>
  )
}

type ProductCreateWizardProps = {
  values: CreateProductFormValues
  setValue: CrudFormGroupComponentProps['setValue']
  productTypeOptions: Array<{ value: CatalogProductType; label: string }>
  activeStep: ProductWizardStep
  onStepChange: (step: ProductWizardStep) => void
  currencyDictionary: CatalogDictionarySelectConfig
  unitDictionary: CatalogDictionarySelectConfig
  errors: Record<string, string>
}

function ProductCreateWizard({
  values,
  setValue,
  productTypeOptions,
  activeStep,
  onStepChange,
  currencyDictionary,
  unitDictionary,
  errors,
}: ProductCreateWizardProps) {
  const t = useT()
  const steps = React.useMemo(
    () => [
      { id: 'basics', label: t('catalog.products.create.steps.basics', 'Details') },
      { id: 'organize', label: t('catalog.products.create.steps.organize', 'Organize') },
      { id: 'variants', label: t('catalog.products.create.steps.variants', 'Variants') },
    ] satisfies Array<{ id: ProductWizardStep; label: string }>,
    [t],
  )

  return (
    <div className="space-y-6">
      <WizardTabs steps={steps} activeStep={activeStep} onSelect={onStepChange} />
      {activeStep === 'basics' ? (
        <ProductBasicsStep
          values={values}
          setValue={setValue}
          productTypeOptions={productTypeOptions}
          currencyDictionary={currencyDictionary}
          unitDictionary={unitDictionary}
          errors={errors}
        />
      ) : activeStep === 'organize' ? (
        <ProductOrganizeStep values={values} setValue={setValue} />
      ) : activeStep === 'variants' ? (
        <ProductVariantsStep values={values} setValue={setValue} />
      ) : (
        null
      )}
    </div>
  )
}

type WizardTabsProps = {
  steps: Array<{ id: ProductWizardStep; label: string }>
  activeStep: ProductWizardStep
  onSelect: (step: ProductWizardStep) => void
}

function WizardTabs({ steps, activeStep, onSelect }: WizardTabsProps) {
  const activeIndex = steps.findIndex((step) => step.id === activeStep)
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border">
      {steps.map((step, index) => {
        const isActive = step.id === activeStep
        const isCompleted = activeIndex > index
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            className={cn(
              'relative pb-3 text-sm font-medium transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-2">
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : (
                <Circle className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
              )}
              {step.label}
            </span>
            <span
              className={cn(
                'absolute inset-x-0 bottom-0 h-0.5 rounded-full',
                isActive ? 'bg-foreground' : 'bg-transparent',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

type SectionCardProps = {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}

function SectionCard({ title, description, action, children }: SectionCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  )
}

type ProductBasicsStepProps = {
  values: CreateProductFormValues
  setValue: CrudFormGroupComponentProps['setValue']
  productTypeOptions: Array<{ value: CatalogProductType; label: string }>
  currencyDictionary: CatalogDictionarySelectConfig
  unitDictionary: CatalogDictionarySelectConfig
  errors: Record<string, string>
}

function ProductBasicsStep({
  values,
  setValue,
  productTypeOptions,
  currencyDictionary,
  unitDictionary,
  errors,
}: ProductBasicsStepProps) {
  const t = useT()
  const mediaDrafts = Array.isArray(values.mediaDrafts)
    ? (values.mediaDrafts as MediaDraft[])
    : []
  const priceEntries = Array.isArray(values.priceEntries)
    ? (values.priceEntries as PriceDraft[])
    : []
  const fieldError = (fieldId: string) =>
    typeof errors?.[fieldId] === 'string' ? errors[fieldId] : undefined
  const setPriceEntries = React.useCallback(
    (next: PriceDraft[]) => setValue('priceEntries', next),
    [setValue],
  )
  const handleAddPrice = React.useCallback(() => {
    setPriceEntries([...priceEntries, createPriceDraft(values.primaryCurrencyCode)])
  }, [priceEntries, setPriceEntries, values.primaryCurrencyCode])
  const productTypeValue =
    typeof values.productType === 'string' ? values.productType : 'simple'
  const normalizedProductType = COMING_SOON_PRODUCT_TYPES.has(productTypeValue as CatalogProductType)
    ? 'simple'
    : productTypeValue

  return (
    <div className="space-y-6">
      <SectionCard
        title={t('catalog.products.create.sections.basics', 'Product basics')}
        description={t('catalog.products.create.sections.basicsHint', 'Set the essentials customers will see first.')}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div data-crud-field-id="title" className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.form.title', 'Title')}
            </label>
            <Input
              value={typeof values.title === 'string' ? values.title : ''}
              onChange={(event) => setValue('title', event.target.value)}
              data-crud-focus-target=""
            />
            <FieldError message={fieldError('title')} />
          </div>
          <div data-crud-field-id="subtitle" className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.form.subtitle', 'Subtitle')}
            </label>
            <Input
              value={typeof values.subtitle === 'string' ? values.subtitle : ''}
              onChange={(event) => setValue('subtitle', event.target.value)}
            />
            <FieldError message={fieldError('subtitle')} />
          </div>
          <div data-crud-field-id="handle" className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.form.handle', 'Handle')}
            </label>
            <HandleInputField
              value={typeof values.handle === 'string' ? values.handle : ''}
              onChange={(next) => setValue('handle', next)}
              error={fieldError('handle')}
            />
          </div>
          <div data-crud-field-id="sku" className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.form.sku', 'SKU')}
            </label>
            <Input
              value={typeof values.sku === 'string' ? values.sku : ''}
              onChange={(event) => setValue('sku', event.target.value)}
            />
            <FieldError message={fieldError('sku')} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div data-crud-field-id="description" className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.form.description', 'Description')}
            </label>
            <textarea
              className="min-h-[96px] w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={typeof values.description === 'string' ? values.description : ''}
              onChange={(event) => setValue('description', event.target.value)}
            />
            <FieldError message={fieldError('description')} />
          </div>
          <div className="space-y-4">
            <div data-crud-field-id="productType" className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('catalog.products.form.productType', 'Product type')}
              </label>
              <select
                className="h-9 w-full rounded border px-2 text-sm"
                value={normalizedProductType}
                onChange={(event) => {
                  const next = event.target.value as CatalogProductType
                  if (COMING_SOON_PRODUCT_TYPES.has(next)) return
                  setValue('productType', next)
                }}
              >
                {productTypeOptions.map((option) => {
                  const comingSoon = COMING_SOON_PRODUCT_TYPES.has(option.value)
                  const label = comingSoon
                    ? `${option.label} (${t('common.comingSoon', 'Coming soon')})`
                    : option.label
                  return (
                    <option key={option.value} value={option.value} disabled={comingSoon}>
                      {label}
                    </option>
                  )
                })}
              </select>
              <p className="text-xs text-muted-foreground">
                {t('catalog.products.form.productTypeComingSoon', 'Bundle and grouped products are coming soon.')}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground" data-crud-field-id="isActive">
              <input
                type="checkbox"
                checked={values.isActive !== false}
                onChange={(event) => setValue('isActive', event.target.checked)}
              />
              {t('catalog.products.form.isActive', 'Active')}
            </label>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t('catalog.products.create.sections.media', 'Media')}
        description={t('catalog.products.create.sections.mediaHint', 'Upload imagery through the attachments module. Files are saved once the product is created.')}
      >
        <ProductMediaSection
          drafts={mediaDrafts}
          onChange={(next) => setValue('mediaDrafts', next)}
        />
      </SectionCard>

      <SectionCard
        title={t('catalog.products.create.sections.defaults', 'Defaults')}
        description={t('catalog.products.create.sections.defaultsHint', 'Currencies and units are managed through shared dictionaries.')}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div data-crud-field-id="primaryCurrencyCode" className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.create.pricing.currencyLabel', 'Default currency')}
            </label>
            <DictionaryEntrySelect
              value={typeof values.primaryCurrencyCode === 'string' ? values.primaryCurrencyCode : undefined}
              onChange={(next) => setValue('primaryCurrencyCode', next ?? '')}
              fetchOptions={currencyDictionary.fetchOptions}
              createOption={currencyDictionary.createOption}
              labels={currencyDictionary.labels}
              allowInlineCreate={Boolean(currencyDictionary.createOption)}
              allowAppearance
              appearanceLabels={currencyDictionary.appearanceLabels}
              manageHref={currencyDictionary.manageHref}
              selectClassName="w-full"
            />
            {currencyDictionary.error ? (
              <p className="text-xs text-red-600">{currencyDictionary.error}</p>
            ) : null}
            <FieldError message={fieldError('primaryCurrencyCode')} />
          </div>
          <div data-crud-field-id="defaultUnit" className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.create.defaults.unit', 'Default unit')}
            </label>
            <DictionaryEntrySelect
              value={typeof values.defaultUnit === 'string' ? values.defaultUnit : undefined}
              onChange={(next) => setValue('defaultUnit', next ?? '')}
              fetchOptions={unitDictionary.fetchOptions}
              createOption={unitDictionary.createOption}
              labels={unitDictionary.labels}
              allowInlineCreate={Boolean(unitDictionary.createOption)}
              allowAppearance
              appearanceLabels={unitDictionary.appearanceLabels}
              manageHref={unitDictionary.manageHref}
              selectClassName="w-full"
            />
            {unitDictionary.error ? (
              <p className="text-xs text-red-600">{unitDictionary.error}</p>
            ) : null}
            <FieldError message={fieldError('defaultUnit')} />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t('catalog.products.create.sections.pricing', 'Pricing')}
        description={t('catalog.products.create.sections.pricingHint', 'Start with a base price and layer additional entries as needed.')}
        action={
          <Button type="button" variant="outline" onClick={handleAddPrice}>
            <Plus className="mr-2 h-4 w-4" />
            {t('catalog.products.create.pricing.addPrice', 'Add price')}
          </Button>
        }
      >
        <ProductPricingPanel
          priceEntries={priceEntries}
          onChange={setPriceEntries}
          currencyDictionary={currencyDictionary}
          baseCurrency={typeof values.primaryCurrencyCode === 'string' ? values.primaryCurrencyCode : null}
        />
      </SectionCard>

      <SectionCard
        title={t('catalog.products.create.sections.options', 'Custom options')}
        description={t('catalog.products.create.sections.optionsHint', 'Collect selections such as size or engraving instructions and reuse templates across products.')}
      >
        <ProductCustomOptionsPanel values={values} setValue={setValue} />
      </SectionCard>
    </div>
  )
}

type ProductOrganizeStepProps = {
  values: CreateProductFormValues
  setValue: CrudFormGroupComponentProps['setValue']
}

function ProductOrganizeStep({ values, setValue }: ProductOrganizeStepProps) {
  const t = useT()
  const organizer = React.useMemo<OrganizerDraft>(() => {
    const raw = values.organizer as OrganizerDraft | undefined
    if (raw && Array.isArray(raw.categories) && Array.isArray(raw.tags) && Array.isArray(raw.salesChannels)) {
      return raw
    }
    return { categories: [], tags: [], salesChannels: [] }
  }, [values.organizer])

  const updateOrganizer = (patch: Partial<OrganizerDraft>) => {
    setValue('organizer', {
      categories: patch.categories ?? organizer.categories,
      tags: patch.tags ?? organizer.tags,
      salesChannels: patch.salesChannels ?? organizer.salesChannels,
    })
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title={t('catalog.products.create.sections.organize', 'Organize products')}
        description={t('catalog.products.create.sections.organizeHint', 'Categories, tags, and sales channels will sync to new APIs soon, but you can already draft the structure here.')}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.create.organize.categories', 'Categories')}
            </label>
            <TagsInput
              value={organizer.categories}
              onChange={(next) => updateOrganizer({ categories: next })}
              placeholder={t('catalog.products.create.organize.categoriesPlaceholder', 'Add category and press Enter')}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.create.organize.tags', 'Tags')}
            </label>
            <TagsInput
              value={organizer.tags}
              onChange={(next) => updateOrganizer({ tags: next })}
              placeholder={t('catalog.products.create.organize.tagsPlaceholder', 'Add tag and press Enter')}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('catalog.products.create.organize.salesChannels', 'Sales channels')}
            </label>
            <TagsInput
              value={organizer.salesChannels}
              onChange={(next) => updateOrganizer({ salesChannels: next })}
              placeholder={t('catalog.products.create.organize.channelsPlaceholder', 'Draft channel codes (API coming soon)')}
              disabled
            />
            <p className="text-xs text-muted-foreground">
              {t('catalog.products.create.organize.salesChannelsDisabled', 'Sales channels will be available once the new API ships.')}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

type ProductVariantsStepProps = {
  values: CreateProductFormValues
  setValue: CrudFormGroupComponentProps['setValue']
}

function ProductVariantsStep({ values, setValue }: ProductVariantsStepProps) {
  const t = useT()
  const currencyCode = typeof values.primaryCurrencyCode === 'string' ? values.primaryCurrencyCode : null
  const productType = (values.productType as CatalogProductType) ?? 'simple'
  return (
    <div className="space-y-6">
      <SectionCard
        title={t('catalog.products.create.sections.variants', 'Variants')}
        description={t('catalog.products.create.sections.variantsHint', 'Generate variants from option combinations or craft them manually. Set per-variant pricing when needed.')}
      >
        <ProductVariantsPanel
          values={values}
          setValue={setValue}
          attributeSchema={resolveAttributeSchemaFromValues(values)}
          currencyCode={currencyCode}
          disabled={!isConfigurableProductType(productType)}
        />
      </SectionCard>
    </div>
  )
}

type AttributeSchemaSidebarProps = {
  values: CreateProductFormValues
  setValue: CrudFormGroupComponentProps['setValue']
}

function AttributeSchemaSidebar({ values, setValue }: AttributeSchemaSidebarProps) {
  return (
    <div className="space-y-4">
      <ProductAttributeSchemaPanel values={values} setValue={setValue} />
    </div>
  )
}

type ProductMediaSectionProps = {
  drafts: MediaDraft[]
  onChange: (drafts: MediaDraft[]) => void
}

function ProductMediaSection({ drafts, onChange }: ProductMediaSectionProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const addFiles = React.useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const additions: MediaDraft[] = Array.from(list).map((file) => ({
        id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `media_${Math.random().toString(36).slice(2, 10)}`,
        file,
        name: file.name,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
      }))
      onChange([...drafts, ...additions])
    },
    [drafts, onChange],
  )

  const handleRemove = React.useCallback(
    (id: string) => {
      const target = drafts.find((draft) => draft.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      onChange(drafts.filter((draft) => draft.id !== id))
    },
    [drafts, onChange],
  )

  React.useEffect(() => {
    return () => {
      drafts.forEach((draft) => URL.revokeObjectURL(draft.previewUrl))
    }
  }, [drafts])

  return (
    <div className="space-y-4">
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center"
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={(event) => {
          event.preventDefault()
          addFiles(event.dataTransfer.files)
        }}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('catalog.products.create.media.upload', 'Upload images')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('catalog.products.create.media.hint', 'Drag and drop or browse your device')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="mr-2 h-4 w-4" />
            {t('catalog.products.create.media.browse', 'Browse files')}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
      {drafts.length ? (
        <div className="space-y-2">
          {drafts.map((draft) => (
            <div key={draft.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{draft.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(draft.size)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('catalog.products.create.media.remove', 'Remove file')}
                onClick={() => handleRemove(draft.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.media.empty', 'No files added yet. Media uploads finalize after product creation.')}
        </p>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return `${bytes}`
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

type HandleInputFieldProps = {
  value: string
  onChange: (value: string) => void
  error?: string
}

function HandleInputField({ value, onChange, error }: HandleInputFieldProps) {
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
      <FieldError message={error} />
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-red-600">{message}</p>
}

type ProductPricingPanelProps = {
  priceEntries: PriceDraft[]
  onChange: (entries: PriceDraft[]) => void
  currencyDictionary: CatalogDictionarySelectConfig
  baseCurrency?: string | null
}

function ProductPricingPanel({
  priceEntries,
  onChange,
  currencyDictionary,
  baseCurrency,
}: ProductPricingPanelProps) {
  const t = useT()
  React.useEffect(() => {
    if (!priceEntries.length) {
      onChange([createPriceDraft(baseCurrency)])
    }
  }, [baseCurrency, onChange, priceEntries.length])
  const updateEntries = (next: PriceDraft[]) => onChange(next)
  const updateEntry = (id: string, patch: Partial<PriceDraft>) => {
    updateEntries(priceEntries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }
  const removeEntry = (id: string) => {
    if (priceEntries.length <= 1) return
    updateEntries(priceEntries.filter((entry) => entry.id !== id))
  }
  const primaryEntry = priceEntries[0] ?? createPriceDraft(baseCurrency)
  const additionalEntries = priceEntries.slice(1)

  return (
    <div className="space-y-4">
      <PriceEntryCard
        entry={primaryEntry}
        onChange={(patch) => updateEntry(primaryEntry.id, patch)}
        currencyDictionary={currencyDictionary}
        isPrimary
      />
      {additionalEntries.length ? (
        <div className="space-y-3">
          {additionalEntries.map((entry) => (
            <PriceEntryCard
              key={entry.id}
              entry={entry}
              onChange={(patch) => updateEntry(entry.id, patch)}
              onRemove={() => removeEntry(entry.id)}
              currencyDictionary={currencyDictionary}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

type PriceEntryCardProps = {
  entry: PriceDraft
  onChange: (patch: Partial<PriceDraft>) => void
  onRemove?: () => void
  currencyDictionary: CatalogDictionarySelectConfig
  isPrimary?: boolean
}

function PriceEntryCard({
  entry,
  onChange,
  onRemove,
  currencyDictionary,
  isPrimary = false,
}: PriceEntryCardProps) {
  const t = useT()
  const priceKinds: Array<{ value: PriceDraft['kind']; label: string }> = [
    { value: 'list', label: t('catalog.products.create.pricing.kind.list', 'List price') },
    { value: 'sale', label: t('catalog.products.create.pricing.kind.sale', 'Sale price') },
    { value: 'tier', label: t('catalog.products.create.pricing.kind.tier', 'Tier price') },
    { value: 'custom', label: t('catalog.products.create.pricing.kind.custom', 'Custom price') },
  ]

  return (
    <div className={cn('space-y-4 rounded-lg border bg-card p-4', isPrimary ? 'border-primary/40' : 'border-border')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            {isPrimary
              ? t('catalog.products.create.pricing.primaryLabel', 'Default price')
              : t('catalog.products.create.pricing.entryLabel', 'Additional price')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('catalog.products.create.pricing.entryHelp', 'Set amount, currency, and availability.')}
          </p>
        </div>
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('catalog.products.create.remove', 'Remove')}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.kind.label', 'Kind')}
          </label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={entry.kind}
            onChange={(event) => onChange({ kind: event.target.value as PriceDraft['kind'] })}
          >
            {priceKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide">
            {t('catalog.products.create.pricing.currency', 'Currency')}
          </label>
          <DictionaryEntrySelect
            value={entry.currencyCode && entry.currencyCode.length ? entry.currencyCode : undefined}
            onChange={(next) => onChange({ currencyCode: next ?? '' })}
            fetchOptions={currencyDictionary.fetchOptions}
            createOption={currencyDictionary.createOption}
            labels={currencyDictionary.labels}
            allowInlineCreate={Boolean(currencyDictionary.createOption)}
            allowAppearance
            appearanceLabels={currencyDictionary.appearanceLabels}
            manageHref={currencyDictionary.manageHref}
            selectClassName="w-full"
          />
          {currencyDictionary.error ? (
            <p className="text-xs text-red-600">{currencyDictionary.error}</p>
          ) : null}
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
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
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
      </div>
    </div>
  )
}
function resolveAttributeSchemaFromValues(values: Record<string, unknown>): CatalogAttributeSchema | null {
  return (
    (values.attributeSchemaResolved as CatalogAttributeSchema | null) ??
    (values.attributeSchema as CatalogAttributeSchema | null) ??
    null
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

async function uploadProductMediaDrafts(
  drafts: MediaDraft[],
  entityId: string,
  recordId: string,
): Promise<{ uploaded: number; failed: number }> {
  if (!drafts.length) return { uploaded: 0, failed: 0 }
  let uploaded = 0
  let failed = 0
  for (const draft of drafts) {
    if (!(draft?.file instanceof File)) continue
    try {
      const formData = new FormData()
      formData.set('entityId', entityId)
      formData.set('recordId', recordId)
      formData.set('file', draft.file)
      const response = await apiCall<Record<string, unknown>>(
        '/api/attachments',
        { method: 'POST', body: formData },
      )
      if (response.ok) uploaded += 1
      else failed += 1
    } catch {
      failed += 1
    }
  }
  return { uploaded, failed }
}

function useCatalogDictionarySelect(key: 'currency' | 'unit'): CatalogDictionarySelectConfig {
  const t = useT()
  const dictionaryIdRef = React.useRef<string | null>(null)
  const [dictionaryReady, setDictionaryReady] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const labels = React.useMemo<DictionarySelectLabels>(() => ({
    placeholder:
      key === 'currency'
        ? t('catalog.products.create.pricing.currencyPlaceholder', 'Select currency')
        : t('catalog.products.create.pricing.unitPlaceholder', 'Select unit'),
    addLabel: t('dictionaries.entries.add', 'Add entry'),
    addPrompt: t('dictionaries.entries.addPrompt', 'Define a value and optional label.'),
    dialogTitle: t('dictionaries.entries.dialogTitle', 'New dictionary entry'),
    valueLabel: t('dictionaries.entries.valueLabel', 'Value'),
    valuePlaceholder: t('dictionaries.entries.valuePlaceholder', 'internal-key'),
    labelLabel: t('dictionaries.entries.labelLabel', 'Label'),
    labelPlaceholder: t('dictionaries.entries.labelPlaceholder', 'Customer-facing label'),
    emptyError: t('dictionaries.entries.emptyError', 'Value is required.'),
    cancelLabel: t('common.cancel', 'Cancel'),
    saveLabel: t('common.save', 'Save'),
    saveShortcutHint: t('ui.forms.shortcuts.save', '⌘/Ctrl + Enter'),
    successCreateLabel: t('dictionaries.entries.created', 'Entry added'),
    errorLoad: t('dictionaries.entries.errorLoad', 'Failed to load dictionary'),
    errorSave: t('dictionaries.entries.errorSave', 'Failed to save entry'),
    loadingLabel: t('common.loading', 'Loading…'),
    manageTitle: t('dictionaries.entries.manage', 'Manage dictionary'),
  }), [key, t])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('dictionaries.appearance.colorLabel', 'Color'),
    colorHelp: t('dictionaries.appearance.colorHelp', 'Pick a highlight color for this entry.'),
    colorClearLabel: t('dictionaries.appearance.colorClear', 'Remove color'),
    iconLabel: t('dictionaries.appearance.iconLabel', 'Icon or emoji'),
    iconPlaceholder: t('dictionaries.appearance.iconPlaceholder', 'Type an emoji or icon token'),
    iconPickerTriggerLabel: t('dictionaries.appearance.iconPickerTrigger', 'Browse icons'),
    iconSearchPlaceholder: t('dictionaries.appearance.iconSearchPlaceholder', 'Search…'),
    iconSearchEmptyLabel: t('dictionaries.appearance.iconSearchEmpty', 'No matches'),
    iconSuggestionsLabel: t('dictionaries.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('dictionaries.appearance.iconClear', 'Remove icon'),
    previewEmptyLabel: t('dictionaries.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fetchOptions = React.useCallback(async () => {
    setError(null)
    try {
      const response = await apiCall<{ id?: string; entries?: Array<{ value?: string; label?: string; color?: string | null; icon?: string | null }> }>(
        `/api/catalog/dictionaries/${key}`,
      )
      if (!response.ok) {
        const fallback =
          key === 'currency'
            ? t('catalog.products.create.pricing.currencyLoadError', 'Unable to load currencies.')
            : t('catalog.products.create.pricing.unitLoadError', 'Unable to load units.')
        setError(fallback)
        setDictionaryReady(false)
        throw new Error(response.result?.error || fallback)
      }
      const dictionaryId = typeof response.result?.id === 'string' ? response.result.id : null
      dictionaryIdRef.current = dictionaryId
      setDictionaryReady(Boolean(dictionaryId))
      const entries = Array.isArray(response.result?.entries) ? response.result.entries : []
      return entries
        .map((entry) => {
          const value =
            typeof entry.value === 'string' && entry.value.trim().length ? entry.value.trim() : null
          if (!value) return null
          const label =
            typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : value
          return {
            value,
            label,
            color: typeof entry.color === 'string' ? entry.color : null,
            icon: typeof entry.icon === 'string' ? entry.icon : null,
          }
        })
        .filter((entry): entry is { value: string; label: string; color: string | null; icon: string | null } => entry !== null)
    } catch (err) {
      setDictionaryReady(false)
      throw err
    }
  }, [key, t])

  const createOptionImpl = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const dictionaryId = dictionaryIdRef.current
      if (!dictionaryId) {
        throw new Error(
          t('catalog.products.create.dictionaries.unavailable', 'Load the dictionary before adding entries.'),
        )
      }
      const response = await apiCall<Record<string, unknown>>(`/api/dictionaries/${dictionaryId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: input.value,
          label: input.label ?? input.value,
          color: input.color ?? undefined,
          icon: input.icon ?? undefined,
        }),
      })
      if (!response.ok) {
        throw new Error(
          response.result?.error ||
            t('catalog.products.create.dictionaries.saveError', 'Unable to save dictionary entry.'),
        )
      }
      const payload = response.result ?? {}
      return {
        value: typeof payload.value === 'string' ? payload.value : input.value,
        label:
          typeof payload.label === 'string' && payload.label.trim().length
            ? payload.label.trim()
            : input.label ?? input.value,
        color: typeof payload.color === 'string' ? payload.color : input.color ?? null,
        icon: typeof payload.icon === 'string' ? payload.icon : input.icon ?? null,
      }
    },
    [t],
  )

  const manageHref =
    key === 'currency'
      ? '/backend/config/dictionaries?key=currency'
      : '/backend/config/dictionaries?key=unit'

  return {
    labels,
    appearanceLabels,
    fetchOptions,
    createOption: dictionaryReady ? createOptionImpl : undefined,
    manageHref,
    error,
  }
}
