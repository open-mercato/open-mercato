"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { cn } from '@open-mercato/shared/lib/utils'
import { Plus, Trash2, FileText, AlignLeft, ChevronLeft, ChevronRight, AlertCircle, Settings } from 'lucide-react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { ProductMediaManager, type ProductMediaItem } from '@open-mercato/core/modules/catalog/components/products/ProductMediaManager'
import {
  PRODUCT_FORM_STEPS,
  type PriceKindSummary,
  type PriceKindApiPayload,
  type TaxRateSummary,
  type ProductOptionInput,
  type VariantPriceValue,
  type VariantDraft,
  type ProductFormValues,
  productFormSchema,
  createInitialProductFormValues,
  createVariantDraft,
  buildOptionValuesKey,
  haveSameOptionValues,
  normalizePriceKindSummary,
  formatTaxRateLabel,
  slugify,
  createLocalId,
  buildOptionSchemaDefinition,
} from '@open-mercato/core/modules/catalog/components/products/productForm'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'

type UiMarkdownEditorProps = {
  value?: string
  height?: number
  onChange?: (value?: string) => void
  previewOptions?: { remarkPlugins?: unknown[] }
}

const MarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading editor…</div>,
}) as unknown as React.ComponentType<UiMarkdownEditorProps>

type ProductFormStep = (typeof PRODUCT_FORM_STEPS)[number]

const TRUE_BOOLEAN_VALUES = new Set(['true', '1', 'yes', 'y', 't'])

const matchField = (fieldId: string) => (value: string) =>
  value === fieldId || value.startsWith(`${fieldId}.`) || value.startsWith(`${fieldId}[`)
const matchPrefix = (prefix: string) => (value: string) => value.startsWith(prefix)

const STEP_FIELD_MATCHERS: Record<ProductFormStep, ((value: string) => boolean)[]> = {
  general: [
    matchField('title'),
    matchField('description'),
    matchField('mediaItems'),
    matchField('mediaDraftId'),
    matchPrefix('defaultMedia'),
  ],
  organize: [matchField('categoryIds'), matchField('channelIds'), matchField('tags')],
  variants: [matchField('hasVariants'), matchPrefix('options'), matchPrefix('variants')],
}

function resolveStepForField(fieldId: string): ProductFormStep | null {
  const normalized = fieldId?.trim()
  if (!normalized) return null
  for (const step of PRODUCT_FORM_STEPS) {
    const matchers = STEP_FIELD_MATCHERS[step]
    if (matchers.some((matcher) => matcher(normalized))) return step
  }
  return null
}

function resolveBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    if (TRUE_BOOLEAN_VALUES.has(normalized)) return true
    if (['false', '0', 'no', 'n', 'f'].includes(normalized)) return false
  }
  if (typeof value === 'number') return value !== 0
  return false
}


export default function CreateCatalogProductPage() {
  const t = useT()
  const router = useRouter()
  const initialValuesRef = React.useRef<ProductFormValues | null>(null)
  if (!initialValuesRef.current) {
    initialValuesRef.current = createInitialProductFormValues()
  }
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([])
  const [taxRates, setTaxRates] = React.useState<TaxRateSummary[]>([])
  React.useEffect(() => {
    const loadPriceKinds = async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: PriceKindApiPayload[] }>(
          '/api/catalog/price-kinds?pageSize=100',
          undefined,
          { errorMessage: t('catalog.priceKinds.errors.load', 'Failed to load price kinds.') },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        setPriceKinds(
          items
            .map((item) => normalizePriceKindSummary(item))
            .filter((item): item is PriceKindSummary => item !== null),
        )
      } catch (err) {
        console.error('catalog.price-kinds.fetch failed', err)
        setPriceKinds([])
      }
    }
    loadPriceKinds().catch(() => {})
  }, [t])

  React.useEffect(() => {
    const loadTaxRates = async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          '/api/sales/tax-rates?pageSize=200',
          undefined,
          { errorMessage: t('catalog.products.create.taxRates.error', 'Failed to load tax rates.'), fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        setTaxRates(
          items.map((item) => {
            const rawRate = typeof item.rate === 'number' ? item.rate : Number(item.rate ?? Number.NaN)
            return {
              id: String(item.id),
              name:
                typeof item.name === 'string' && item.name.trim().length
                  ? item.name
                  : t('catalog.products.create.taxRates.unnamed', 'Untitled tax rate'),
              code: typeof item.code === 'string' && item.code.trim().length ? item.code : null,
              rate: Number.isFinite(rawRate) ? rawRate : null,
              isDefault: resolveBooleanFlag(
                typeof item.isDefault !== 'undefined' ? item.isDefault : item.is_default,
              ),
            }
          }),
        )
      } catch (err) {
        console.error('sales.tax-rates.fetch failed', err)
        setTaxRates([])
      }
    }
    loadTaxRates().catch(() => {})
  }, [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'builder',
      column: 1,
      component: ({ values, setValue, errors }: CrudFormGroupComponentProps) => (
        <ProductBuilder
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          priceKinds={priceKinds}
          taxRates={taxRates}
        />
      ),
    },
    {
      id: 'product-meta',
      column: 2,
      title: t('catalog.products.create.meta.title', 'Product meta'),
      description: t('catalog.products.create.meta.description', 'Manage subtitle and handle for storefronts.'),
      component: ({ values, setValue, errors }: CrudFormGroupComponentProps) => (
        <ProductMetaSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          taxRates={taxRates}
        />
      ),
    },
  ], [priceKinds, taxRates, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ProductFormValues>
          title={t('catalog.products.create.title', 'Create product')}
          backHref="/backend/catalog/products"
          fields={[]}
          groups={groups}
          initialValues={initialValuesRef.current ?? createInitialProductFormValues()}
          schema={productFormSchema}
          submitLabel={t('catalog.products.create.submit', 'Create')}
          cancelHref="/backend/catalog/products"
          onSubmit={async (formValues) => {
            const title = formValues.title?.trim()
            if (!title) {
              throw createCrudFormError(t('catalog.products.create.errors.title', 'Provide a product title.'), {
                title: t('catalog.products.create.errors.title', 'Provide a product title.'),
              })
            }
            const handle = formValues.handle?.trim() || undefined
            const description = formValues.description?.trim() || undefined
            const defaultMediaId =
              typeof formValues.defaultMediaId === 'string' && formValues.defaultMediaId.trim().length
                ? formValues.defaultMediaId
                : null
            const mediaItems = Array.isArray(formValues.mediaItems) ? formValues.mediaItems : []
            const attachmentIds = mediaItems
              .map((item) => (typeof item.id === 'string' ? item.id : null))
              .filter((value): value is string => !!value)
            const mediaDraftId = typeof formValues.mediaDraftId === 'string' ? formValues.mediaDraftId : ''
            const defaultMediaEntry = defaultMediaId ? mediaItems.find((item) => item.id === defaultMediaId) : null
            const defaultMediaUrl = defaultMediaEntry
              ? buildAttachmentImageUrl(defaultMediaEntry.id, {
                  slug: slugifyAttachmentFileName(defaultMediaEntry.fileName),
                })
              : null
            const optionSchemaDefinition = buildOptionSchemaDefinition(formValues.options, title)
            const productPayload: Record<string, unknown> = {
              title,
              subtitle: formValues.subtitle?.trim() || undefined,
              description,
              handle,
              isConfigurable: Boolean(formValues.hasVariants),
              defaultMediaId: defaultMediaId ?? undefined,
              defaultMediaUrl: defaultMediaUrl ?? undefined,
            }
            if (optionSchemaDefinition) {
              productPayload.optionSchema = optionSchemaDefinition
            }
            const categoryIds = Array.isArray(formValues.categoryIds)
              ? formValues.categoryIds
                  .map((id) => (typeof id === 'string' ? id.trim() : ''))
                  .filter((id) => id.length)
              : []
            if (categoryIds.length) {
              productPayload.categoryIds = Array.from(new Set(categoryIds))
            }
            const tags = Array.isArray(formValues.tags)
              ? Array.from(
                  new Set(
                    formValues.tags
                      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
                      .filter((tag) => tag.length),
                  ),
                )
              : []
            if (tags.length) {
              productPayload.tags = tags
            }
            const channelIds = Array.isArray(formValues.channelIds)
              ? formValues.channelIds
                  .map((id) => (typeof id === 'string' ? id.trim() : ''))
                  .filter((id) => id.length)
              : []
            if (channelIds.length) {
              productPayload.offers = channelIds.map((channelId) => ({
                channelId,
                title,
                description,
                defaultMediaId: defaultMediaId ?? undefined,
                defaultMediaUrl: defaultMediaUrl ?? undefined,
              }))
            }

            const { result: created } = await createCrud<{ id?: string }>('catalog/products', productPayload)
            const productId = created?.id
            if (!productId) {
              throw createCrudFormError(t('catalog.products.create.errors.id', 'Product id missing after create.'))
            }

            const variantDrafts = Array.isArray(formValues.variants) && formValues.variants.length
              ? formValues.variants
              : [createVariantDraft(formValues.taxRateId ?? null, { isDefault: true })]
            const variantIdMap: Record<string, string> = {}
            for (const variant of variantDrafts) {
              const variantPayload: Record<string, unknown> = {
                productId,
                name: variant.title?.trim() || Object.values(variant.optionValues).join(' / ') || 'Variant',
                sku: variant.sku?.trim() || undefined,
                isDefault: Boolean(variant.isDefault),
                isActive: true,
                optionValues: Object.keys(variant.optionValues).length ? variant.optionValues : undefined,
              }
              const { result: variantResult } = await createCrud<{ id?: string; variantId?: string }>(
                'catalog/variants',
                variantPayload,
              )
              const variantId = variantResult?.variantId ?? variantResult?.id
              if (!variantId) {
                throw createCrudFormError(t('catalog.products.create.errors.variant', 'Failed to create variant.'))
              }
              variantIdMap[variant.id] = variantId
            }

            const productLevelTaxRateId = formValues.taxRateId ?? null
            for (const variant of variantDrafts) {
              const variantId = variantIdMap[variant.id]
              if (!variantId) continue
              const resolvedVariantTaxRateId = variant.taxRateId ?? productLevelTaxRateId
              const resolvedVariantTaxRate =
                resolvedVariantTaxRateId
                  ? taxRates.find((rate) => rate.id === resolvedVariantTaxRateId)?.rate ?? null
                  : null
              for (const priceKind of priceKinds) {
                const value = variant.prices?.[priceKind.id]?.amount?.trim()
                if (!value) continue
                const numeric = Number(value)
                if (Number.isNaN(numeric)) continue
                if (numeric < 0) {
                  throw createCrudFormError(
                    t('catalog.products.create.errors.priceNonNegative', 'Prices must be zero or greater.'),
                  )
                }
                const currencyCode =
                  typeof priceKind.currencyCode === 'string' && priceKind.currencyCode.trim().length
                    ? priceKind.currencyCode.trim().toUpperCase()
                    : ''
                if (!currencyCode) {
                  throw createCrudFormError(
                    t('catalog.products.create.errors.currency', 'Provide a currency for all price kinds.'),
                    {},
                  )
                }
              const pricePayload: Record<string, unknown> = {
                productId,
                variantId,
                currencyCode,
                priceKindId: priceKind.id,
              }
              if (resolvedVariantTaxRateId) {
                pricePayload.taxRateId = resolvedVariantTaxRateId
              } else if (typeof resolvedVariantTaxRate === 'number' && Number.isFinite(resolvedVariantTaxRate)) {
                pricePayload.taxRate = resolvedVariantTaxRate
              }
              if (priceKind.displayMode === 'including-tax') {
                pricePayload.unitPriceGross = numeric
              } else {
                  pricePayload.unitPriceNet = numeric
                }
                await createCrud('catalog/prices', pricePayload)
              }
            }

            if (mediaDraftId && attachmentIds.length) {
              const transfer = await apiCall<{ ok?: boolean; error?: string }>(
                '/api/attachments/transfer',
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    entityId: E.catalog.catalog_product,
                    attachmentIds,
                    fromRecordId: mediaDraftId,
                    toRecordId: productId,
                  }),
                },
                { fallback: null },
              )
              if (!transfer.ok) {
                console.error('attachments.transfer.failed', transfer.result?.error)
              }
            }

            flash(t('catalog.products.create.success', 'Product created.'), 'success')
            router.push('/backend/catalog/products')
          }}
        />
      </PageBody>
    </Page>
  )
}

type ProductBuilderProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
}

type ProductMetaSectionProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  taxRates: TaxRateSummary[]
}

type PickerOption = {
  value: string
  label: string
  description?: string | null
}

function ProductBuilder({ values, setValue, errors, priceKinds, taxRates }: ProductBuilderProps) {
  const t = useT()
  const steps = PRODUCT_FORM_STEPS
  const [currentStep, setCurrentStep] = React.useState(0)
  const [categoryOptionsMap, setCategoryOptionsMap] = React.useState<Record<string, PickerOption>>({})
  const [channelOptionsMap, setChannelOptionsMap] = React.useState<Record<string, PickerOption>>({})
  const [tagOptionsMap, setTagOptionsMap] = React.useState<Record<string, PickerOption>>({})

  const registerPickerOptions = React.useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, PickerOption>>>,
      options: PickerOption[],
    ) => {
      setter((prev) => {
        const next = { ...prev }
        options.forEach((option) => {
          if (option.value) next[option.value] = option
        })
        return next
      })
    },
    [],
  )

  const registerCategoryOptions = React.useCallback(
    (options: PickerOption[]) => registerPickerOptions(setCategoryOptionsMap, options),
    [registerPickerOptions],
  )
  const registerChannelOptions = React.useCallback(
    (options: PickerOption[]) => registerPickerOptions(setChannelOptionsMap, options),
    [registerPickerOptions],
  )
  const registerTagOptions = React.useCallback(
    (options: PickerOption[]) => registerPickerOptions(setTagOptionsMap, options),
    [registerPickerOptions],
  )

  const categorySuggestions = React.useMemo(() => Object.values(categoryOptionsMap), [categoryOptionsMap])
  const channelSuggestions = React.useMemo(() => Object.values(channelOptionsMap), [channelOptionsMap])
  const tagSuggestions = React.useMemo(() => Object.values(tagOptionsMap), [tagOptionsMap])

  const resolveCategoryLabel = React.useCallback(
    (id: string) => categoryOptionsMap[id]?.label ?? id,
    [categoryOptionsMap],
  )
  const resolveCategoryDescription = React.useCallback(
    (id: string) => categoryOptionsMap[id]?.description ?? null,
    [categoryOptionsMap],
  )
  const resolveChannelLabel = React.useCallback(
    (id: string) => channelOptionsMap[id]?.label ?? id,
    [channelOptionsMap],
  )
  const resolveChannelDescription = React.useCallback(
    (id: string) => channelOptionsMap[id]?.description ?? null,
    [channelOptionsMap],
  )
  const resolveTagLabel = React.useCallback((id: string) => tagOptionsMap[id]?.label ?? id, [tagOptionsMap])
  const defaultTaxRate = React.useMemo(
    () => (values.taxRateId ? taxRates.find((rate) => rate.id === values.taxRateId) ?? null : null),
    [taxRates, values.taxRateId],
  )
  React.useEffect(() => {
    if (values.taxRateId) return
    if (!taxRates.length) return
    const fallback = taxRates.find((rate) => rate.isDefault)
    if (!fallback) return
    setValue('taxRateId', fallback.id)
  }, [taxRates, setValue, values.taxRateId])
  const stepErrors = React.useMemo(() => {
    const map = steps.reduce<Record<ProductFormStep, string[]>>((acc, step) => {
      acc[step] = []
      return acc
    }, {} as Record<ProductFormStep, string[]>)
    Object.entries(errors).forEach(([fieldId, message]) => {
      const step = resolveStepForField(fieldId)
      if (!step) return
      const text = typeof message === 'string' && message.trim().length ? message.trim() : null
      if (text) map[step] = [...map[step], text]
    })
    return map
  }, [errors, steps])
  const errorSignature = React.useMemo(() => Object.keys(errors).sort().join('|'), [errors])
  const lastErrorSignatureRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!errorSignature || errorSignature === lastErrorSignatureRef.current) return
    lastErrorSignatureRef.current = errorSignature
    const currentStepKey = steps[currentStep]
    if (currentStepKey && stepErrors[currentStepKey]?.length) return
    const fallbackIndex = steps.findIndex((step) => (stepErrors[step] ?? []).length > 0)
    if (fallbackIndex >= 0 && fallbackIndex !== currentStep) {
      setCurrentStep(fallbackIndex)
    }
  }, [currentStep, errorSignature, setCurrentStep, stepErrors, steps])
  const defaultTaxRateLabel = defaultTaxRate ? formatTaxRateLabel(defaultTaxRate) : null
  const inventoryDisabledHint = t(
    'catalog.products.create.variantsBuilder.inventoryDisabled',
    'Inventory tracking controls are not available yet.',
  )

  React.useEffect(() => {
    if (currentStep >= steps.length) setCurrentStep(0)
  }, [currentStep, steps.length])

  const currentStepKey = steps[currentStep] ?? steps[0]

  const mediaItems = Array.isArray(values.mediaItems) ? values.mediaItems : []

  const loadCategorySuggestions = React.useCallback(
    async (term?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '200', view: 'manage' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; parentName?: string | null }> }>(
          `/api/catalog/categories?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.categoriesLoadError', 'Failed to load categories') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label = typeof entry.name === 'string' && entry.name.trim().length ? entry.name : value
            const description =
              typeof entry.parentName === 'string' && entry.parentName.trim().length ? entry.parentName : null
            return { value, label, description }
          })
          .filter((option): option is PickerOption => !!option)
        registerCategoryOptions(options)
        return options
      } catch {
        return []
      }
    },
    [registerCategoryOptions, t],
  )

  const loadChannelSuggestions = React.useCallback(
    async (term?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '100', isActive: 'true' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; code?: string }> }>(
          `/api/sales/channels?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.channelsLoadError', 'Failed to load channels') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label =
              typeof entry.name === 'string' && entry.name.trim().length
                ? entry.name
                : typeof entry.code === 'string' && entry.code.trim().length
                  ? entry.code
                  : value
            const description = typeof entry.code === 'string' && entry.code.trim().length ? entry.code : null
            return { value, label, description }
          })
          .filter((option): option is PickerOption => !!option)
        registerChannelOptions(options)
        return options
      } catch {
        return []
      }
    },
    [registerChannelOptions, t],
  )

  const loadTagSuggestions = React.useCallback(
    async (term?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '100' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ label?: string }> }>(
          `/api/catalog/tags?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.tagsLoadError', 'Failed to load tags') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : ''
            if (!rawLabel) return null
            return { value: rawLabel, label: rawLabel }
          })
          .filter((option): option is PickerOption => !!option)
        registerTagOptions(options)
        return options
      } catch {
        return []
      }
    },
    [registerTagOptions, t],
  )

  const handleMediaItemsChange = React.useCallback(
    (nextItems: ProductMediaItem[]) => {
      setValue('mediaItems', nextItems)
      const hasCurrent = nextItems.some((item) => item.id === values.defaultMediaId)
      if (!hasCurrent) {
        const fallbackId = nextItems[0]?.id ?? null
        setValue('defaultMediaId', fallbackId)
        if (fallbackId && nextItems[0]) {
          setValue(
            'defaultMediaUrl',
            buildAttachmentImageUrl(fallbackId, {
              slug: slugifyAttachmentFileName(nextItems[0].fileName),
            }),
          )
        } else {
          setValue('defaultMediaUrl', '')
        }
      }
    },
    [setValue, values.defaultMediaId],
  )

  const handleDefaultMediaChange = React.useCallback(
    (attachmentId: string | null) => {
      setValue('defaultMediaId', attachmentId)
      if (!attachmentId) {
        setValue('defaultMediaUrl', '')
        return
      }
      const target = mediaItems.find((item) => item.id === attachmentId)
      if (target) {
        setValue(
          'defaultMediaUrl',
          buildAttachmentImageUrl(target.id, { slug: slugifyAttachmentFileName(target.fileName) }),
        )
      }
    },
    [mediaItems, setValue],
  )

  const ensureVariants = React.useCallback(() => {
    const optionDefinitions = Array.isArray(values.options) ? values.options : []
    if (!values.hasVariants || !optionDefinitions.length) {
      if (!values.variants || !values.variants.length) {
        setValue('variants', [createVariantDraft(values.taxRateId ?? null, { isDefault: true })])
      }
      return
    }
    const combos = buildVariantCombinations(optionDefinitions)
    const existing = Array.isArray(values.variants) ? values.variants : []
    const existingByKey = new Map(existing.map((variant) => [buildOptionValuesKey(variant.optionValues), variant]))
    let hasDefault = existing.some((variant) => variant.isDefault)
    let changed = existing.length !== combos.length
    const nextVariants: VariantDraft[] = combos.map((combo, index) => {
      const key = buildOptionValuesKey(combo)
      const existingMatch = existingByKey.get(key)
      if (existingMatch) {
        if (existingMatch.isDefault) hasDefault = true
        if (!haveSameOptionValues(existingMatch.optionValues, combo)) {
          changed = true
          return { ...existingMatch, optionValues: combo }
        }
        if (existing[index] !== existingMatch) {
          changed = true
        }
        return existingMatch
      }
      changed = true
      return createVariantDraft(values.taxRateId ?? null, {
        title: Object.values(combo).join(' / '),
        optionValues: combo,
      })
    })
    if (!nextVariants.length) return
    if (!hasDefault) {
      changed = true
      nextVariants[0] = { ...nextVariants[0], isDefault: true }
    }
    if (changed) {
      setValue('variants', nextVariants)
    }
  }, [values.options, values.variants, values.hasVariants, setValue])

  React.useEffect(() => {
    ensureVariants()
  }, [ensureVariants])

  React.useEffect(() => {
    if (!values.taxRateId) return
    const variants = Array.isArray(values.variants) ? values.variants : []
    if (!variants.length) return
    let changed = false
    const nextVariants = variants.map((variant) => {
      if (variant.taxRateId) return variant
      changed = true
      return { ...variant, taxRateId: values.taxRateId }
    })
    if (changed) {
      setValue('variants', nextVariants)
    }
  }, [values.taxRateId, values.variants, setValue])
  const setVariantField = React.useCallback(
    (variantId: string, field: keyof VariantDraft, value: unknown) => {
      const next = (Array.isArray(values.variants) ? values.variants : []).map((variant) => {
        if (variant.id !== variantId) return variant
        return { ...variant, [field]: value }
      })
      setValue('variants', next)
    },
    [values.variants, setValue],
  )

  const setVariantPrice = React.useCallback(
    (variantId: string, priceKindId: string, amount: string) => {
      if (amount.trim().startsWith('-')) return
      const next = (Array.isArray(values.variants) ? values.variants : []).map((variant) => {
        if (variant.id !== variantId) return variant
        const nextPrices = { ...(variant.prices ?? {}) }
        if (amount === '') {
          delete nextPrices[priceKindId]
        } else {
          nextPrices[priceKindId] = { amount }
        }
        return {
          ...variant,
          prices: nextPrices,
        }
      })
      setValue('variants', next)
    },
    [values.variants, setValue],
  )

  const markDefaultVariant = React.useCallback((variantId: string) => {
    const next = (Array.isArray(values.variants) ? values.variants : []).map((variant) => ({
      ...variant,
      isDefault: variant.id === variantId,
    }))
    setValue('variants', next)
  }, [values.variants, setValue])

  const handleOptionTitleChange = React.useCallback((optionId: string, title: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).map((option) => {
      if (option.id !== optionId) return option
      return { ...option, title }
    })
    setValue('options', next)
  }, [values.options, setValue])

  const setOptionValues = React.useCallback((optionId: string, labels: string[]) => {
    const normalized = labels
      .map((label) => label.trim())
      .filter((label) => label.length)
    const unique = Array.from(new Set(normalized))
    const next = (Array.isArray(values.options) ? values.options : []).map((option) => {
      if (option.id !== optionId) return option
      const existingByLabel = new Map(option.values.map((value) => [value.label, value]))
      const nextValues = unique.map((label) => existingByLabel.get(label) ?? { id: createLocalId(), label })
      return {
        ...option,
        values: nextValues,
      }
    })
    setValue('options', next)
  }, [values.options, setValue])

  const addOption = React.useCallback(() => {
    const next = [
      ...(Array.isArray(values.options) ? values.options : []),
      { id: createLocalId(), title: '', values: [] },
    ]
    setValue('options', next)
  }, [values.options, setValue])

  const removeOption = React.useCallback((optionId: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).filter((option) => option.id !== optionId)
    setValue('options', next)
  }, [values.options, setValue])


  return (
    <div className="space-y-6">
      <nav className="flex gap-6 border-b pb-2 text-sm font-medium">
        {steps.map((step, index) => (
          <button
            key={step}
            type="button"
            className={cn(
              'relative pb-2',
              currentStep === index ? 'text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => setCurrentStep(index)}
          >
            {step === 'general' && t('catalog.products.create.steps.general', 'General data')}
            {step === 'variants' && t('catalog.products.create.steps.variants', 'Variants')}
            {(stepErrors[step]?.length ?? 0) > 0 ? (
              <span className="absolute -right-2 top-0 h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
            ) : null}
            {currentStep === index ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground rounded-full" />
            ) : null}
          </button>
        ))}
      </nav>

      {currentStepKey === 'general' ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              {t('catalog.products.form.title', 'Title')}
              <span className="text-red-600">*</span>
            </Label>
            <Input
              value={values.title}
              onChange={(event) => setValue('title', event.target.value)}
              placeholder={t('catalog.products.create.placeholders.title', 'e.g., Summer sneaker')}
            />
            {errors.title ? <p className="text-xs text-red-600">{errors.title}</p> : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('catalog.products.form.description', 'Description')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setValue('useMarkdown', !values.useMarkdown)}
                className="gap-2 text-xs"
              >
                {values.useMarkdown ? <AlignLeft className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                {values.useMarkdown
                  ? t('catalog.products.create.actions.usePlain', 'Use plain text')
                  : t('catalog.products.create.actions.useMarkdown', 'Use markdown')}
              </Button>
            </div>
            {values.useMarkdown ? (
              <div data-color-mode="light" className="overflow-hidden rounded-md border">
                <MarkdownEditor
                  value={values.description}
                  height={260}
                  onChange={(val) => setValue('description', val ?? '')}
                  previewOptions={{ remarkPlugins: [] }}
                />
              </div>
            ) : (
              <textarea
                className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={values.description}
                onChange={(event) => setValue('description', event.target.value)}
                placeholder={t('catalog.products.create.placeholders.description', 'Describe the product...')}
              />
            )}
          </div>

          <ProductMediaManager
            entityId={E.catalog.catalog_product}
            draftRecordId={values.mediaDraftId}
            items={mediaItems}
            defaultMediaId={values.defaultMediaId ?? null}
            onItemsChange={handleMediaItemsChange}
            onDefaultChange={handleDefaultMediaChange}
          />
        </div>
      ) : null}

      {currentStepKey === 'organize' ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{t('catalog.products.create.organize.categoriesLabel', 'Categories')}</Label>
            <TagsInput
              value={Array.isArray(values.categoryIds) ? values.categoryIds : []}
              onChange={(next) => setValue('categoryIds', next)}
              suggestions={categorySuggestions}
              loadSuggestions={loadCategorySuggestions}
              allowCustomValues={false}
              resolveLabel={resolveCategoryLabel}
              resolveDescription={resolveCategoryDescription}
              placeholder={t('catalog.products.create.organize.categoriesPlaceholder', 'Search categories')}
            />
            <p className="text-xs text-muted-foreground">
              {t('catalog.products.create.organize.categoriesHelp', 'Assign products to one or more taxonomy nodes.')}
            </p>
            {errors.categoryIds ? <p className="text-xs text-red-600">{errors.categoryIds}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>{t('catalog.products.create.organize.channelsLabel', 'Sales channels')}</Label>
            <TagsInput
              value={Array.isArray(values.channelIds) ? values.channelIds : []}
              onChange={(next) => setValue('channelIds', next)}
              suggestions={channelSuggestions}
              loadSuggestions={loadChannelSuggestions}
              allowCustomValues={false}
              resolveLabel={resolveChannelLabel}
              resolveDescription={resolveChannelDescription}
              placeholder={t('catalog.products.create.organize.channelsPlaceholder', 'Pick channels')}
            />
            <p className="text-xs text-muted-foreground">
              {t('catalog.products.create.organize.channelsHelp', 'Selected channels will receive default offers for this product.')}
            </p>
            {errors.channelIds ? <p className="text-xs text-red-600">{errors.channelIds}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>{t('catalog.products.create.organize.tagsLabel', 'Tags')}</Label>
            <TagsInput
              value={Array.isArray(values.tags) ? values.tags : []}
              onChange={(next) => setValue('tags', next)}
              suggestions={tagSuggestions}
              loadSuggestions={loadTagSuggestions}
              resolveLabel={resolveTagLabel}
              placeholder={t('catalog.products.create.organize.tagsPlaceholder', 'Add tag and press Enter')}
            />
            <p className="text-xs text-muted-foreground">
              {t('catalog.products.create.organize.tagsHelp', 'Describe products with shared labels to build quick filters.')}
            </p>
            {errors.tags ? <p className="text-xs text-red-600">{errors.tags}</p> : null}
          </div>
        </div>
      ) : null}

      {currentStepKey === 'variants' ? (
        <div className="space-y-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={values.hasVariants}
              onChange={(event) => setValue('hasVariants', event.target.checked)}
            />
            {t('catalog.products.create.variantsBuilder.toggle', 'Yes, this is a product with variants')}
          </label>

          {values.hasVariants ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('catalog.products.create.optionsBuilder.title', 'Product options')}</h3>
                <Button type="button" variant="outline" size="sm" onClick={addOption}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('catalog.products.create.optionsBuilder.add', 'Add option')}
                </Button>
              </div>
              {(Array.isArray(values.options) ? values.options : []).map((option) => (
                <div key={option.id} className="rounded-md bg-muted/40 p-4">
                  <div className="flex items-center gap-2">
                    <Input
                      value={option.title}
                      onChange={(event) => handleOptionTitleChange(option.id, event.target.value)}
                      placeholder={t('catalog.products.create.optionsBuilder.placeholder', 'e.g., Color')}
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon" type="button" onClick={() => removeOption(option.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground">
                      {t('catalog.products.create.optionsBuilder.values', 'Values')}
                    </Label>
                    <TagsInput
                      value={option.values.map((value) => value.label)}
                      onChange={(labels) => setOptionValues(option.id, labels)}
                      placeholder={t('catalog.products.create.optionsBuilder.valuePlaceholder', 'Type a value and press Enter')}
                    />
                  </div>
                </div>
              ))}
              {!values.options?.length ? (
                <p className="text-sm text-muted-foreground">
                  {t('catalog.products.create.optionsBuilder.empty', 'No options yet. Add your first option to generate variants.')}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('catalog.products.create.variantsBuilder.defaultOption', 'Default option')}</th>
                    <th className="px-3 py-2 text-left">{t('catalog.products.form.variants', 'Variant title')}</th>
                    <th className="px-3 py-2 text-left">{t('catalog.products.create.variantsBuilder.sku', 'SKU')}</th>
                    <th className="px-3 py-2 text-left">{t('catalog.products.create.variantsBuilder.vatColumn', 'Tax class')}</th>
                    {priceKinds.map((kind) => (
                      <th key={kind.id} className="px-3 py-2 text-left">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span>
                              {t('catalog.products.create.variantsBuilder.priceColumn', 'Price {{title}}').replace('{{title}}', kind.title)}
                            </span>
                            <small
                              title={
                                kind.displayMode === 'including-tax'
                                  ? t('catalog.priceKinds.form.displayMode.include', 'Including tax')
                                  : t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax')
                              }
                              className="text-xs text-muted-foreground"
                            >
                              {kind.displayMode === 'including-tax' ? 'Ⓣ' : 'Ⓝ'}
                            </small>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {kind.currencyCode?.toUpperCase() ??
                              t('catalog.products.create.variantsBuilder.currencyMissing', 'Currency missing')}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center">{t('catalog.products.create.variantsBuilder.manageInventory', 'Managed inventory')}</th>
                    <th className="px-3 py-2 text-center">{t('catalog.products.create.variantsBuilder.allowBackorder', 'Allow backorder')}</th>
                    <th className="px-3 py-2 text-center">{t('catalog.products.create.variantsBuilder.inventoryKit', 'Has inventory kit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(values.variants) && values.variants.length
                    ? values.variants
                    : [createVariantDraft(values.taxRateId ?? null, { isDefault: true })]
                  ).map((variant) => (
                    <tr key={variant.id} className="border-t">
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-1 text-xs">
                          <input
                            type="radio"
                            name="defaultVariant"
                            checked={variant.isDefault}
                            onChange={() => markDefaultVariant(variant.id)}
                          />
                          {variant.isDefault
                            ? t('catalog.products.create.variantsBuilder.defaultLabel', 'Default option value')
                            : t('catalog.products.create.variantsBuilder.makeDefault', 'Set as default')}
                        </label>
                        {values.hasVariants && variant.optionValues
                          ? (
                            <p className="text-xs text-muted-foreground">{Object.values(variant.optionValues).join(' / ')}</p>
                          )
                          : null}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={variant.title}
                          onChange={(event) => setVariantField(variant.id, 'title', event.target.value)}
                          placeholder={t('catalog.products.create.variantsBuilder.titlePlaceholder', 'Variant title')}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={variant.sku}
                          onChange={(event) => setVariantField(variant.id, 'sku', event.target.value)}
                          placeholder={t('catalog.products.create.variantsBuilder.skuPlaceholder', 'e.g., SKU-001')}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={variant.taxRateId ?? ''}
                          onChange={(event) => setVariantField(variant.id, 'taxRateId', event.target.value || null)}
                          disabled={!taxRates.length}
                        >
                          <option value="">
                            {defaultTaxRateLabel
                              ? t('catalog.products.create.variantsBuilder.vatOptionDefault', 'Use product tax class ({{label}})').replace('{{label}}', defaultTaxRateLabel)
                              : t('catalog.products.create.variantsBuilder.vatOptionNone', 'No tax class')}
                          </option>
                          {taxRates.map((rate) => (
                            <option key={rate.id} value={rate.id}>
                              {formatTaxRateLabel(rate)}
                            </option>
                          ))}
                        </select>
                      </td>
                      {priceKinds.map((kind) => (
                        <td key={kind.id} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {kind.currencyCode ?? '—'}
                            </span>
                            <input
                              type="number"
                              className="w-full rounded-md border px-2 py-1"
                              value={variant.prices?.[kind.id]?.amount ?? ''}
                              onChange={(event) => setVariantPrice(variant.id, kind.id, event.target.value)}
                              placeholder="0.00"
                              min={0}
                            />
                          </div>
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-60"
                          checked={variant.manageInventory}
                          onChange={(event) => setVariantField(variant.id, 'manageInventory', event.target.checked)}
                          disabled
                          title={inventoryDisabledHint}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-60"
                          checked={variant.allowBackorder}
                          onChange={(event) => setVariantField(variant.id, 'allowBackorder', event.target.checked)}
                          disabled
                          title={inventoryDisabledHint}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-60"
                          checked={variant.hasInventoryKit}
                          onChange={(event) => setVariantField(variant.id, 'hasInventoryKit', event.target.checked)}
                          disabled
                          title={inventoryDisabledHint}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!priceKinds.length ? (
              <div className="flex items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {t('catalog.products.create.variantsBuilder.noPriceKinds', 'Configure price kinds in Catalog settings to add price columns.')}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('catalog.products.create.steps.previous', 'Previous')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
          className="gap-2"
        >
          {t('catalog.products.create.steps.continue', 'Continue')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ProductMetaSection({ values, setValue, errors, taxRates }: ProductMetaSectionProps) {
  const t = useT()
  const handleValue = typeof values.handle === 'string' ? values.handle : ''
  const titleSource = typeof values.title === 'string' ? values.title : ''
  const autoHandleEnabledRef = React.useRef(handleValue.trim().length === 0)

  React.useEffect(() => {
    if (!autoHandleEnabledRef.current) return
    const normalizedTitle = titleSource.trim()
    if (!normalizedTitle) {
      if (handleValue) {
        setValue('handle', '')
      }
      return
    }
    const nextHandle = slugify(normalizedTitle)
    if (nextHandle !== handleValue) {
      setValue('handle', nextHandle)
    }
  }, [titleSource, handleValue, setValue])

  const handleHandleInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value
      autoHandleEnabledRef.current = nextValue.trim().length === 0
      setValue('handle', nextValue)
    },
    [setValue],
  )

  const handleGenerateHandle = React.useCallback(() => {
    const slug = slugify(titleSource)
    autoHandleEnabledRef.current = true
    setValue('handle', slug)
  }, [titleSource, setValue])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('catalog.products.form.subtitle', 'Subtitle')}</Label>
        <Input
          value={typeof values.subtitle === 'string' ? values.subtitle : ''}
          onChange={(event) => setValue('subtitle', event.target.value)}
          placeholder={t('catalog.products.create.placeholders.subtitle', 'Optional subtitle')}
        />
        {errors.subtitle ? <p className="text-xs text-red-600">{errors.subtitle}</p> : null}
      </div>

      <div className="space-y-2">
        <Label>{t('catalog.products.form.handle', 'Handle')}</Label>
        <div className="flex gap-2">
          <Input
            value={handleValue}
            onChange={handleHandleInputChange}
            placeholder={t('catalog.products.create.placeholders.handle', 'e.g., summer-sneaker')}
            className="font-mono lowercase"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateHandle}
          >
            {t('catalog.products.create.actions.generateHandle', 'Generate')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.handleHelp', 'Handle is used for URLs and must be unique.')}
        </p>
        {errors.handle ? <p className="text-xs text-red-600">{errors.handle}</p> : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t('catalog.products.create.taxRates.label', 'Tax class')}</Label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.open('/backend/config/sales?section=tax-rates', '_blank', 'noopener,noreferrer')
              }
            }}
            title={t('catalog.products.create.taxRates.manage', 'Manage tax classes')}
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            <span className="sr-only">{t('catalog.products.create.taxRates.manage', 'Manage tax classes')}</span>
          </Button>
        </div>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={values.taxRateId ?? ''}
          onChange={(event) => setValue('taxRateId', event.target.value || null)}
          disabled={!taxRates.length}
        >
          <option value="">
            {taxRates.length
              ? t('catalog.products.create.taxRates.noneSelected', 'No tax class selected')
              : t('catalog.products.create.taxRates.emptyOption', 'No tax classes available')}
          </option>
          {taxRates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {formatTaxRateLabel(rate)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {taxRates.length
            ? t('catalog.products.create.taxRates.help', 'Applied to new prices unless overridden per variant.')
            : t('catalog.products.create.taxRates.empty', 'Define tax classes under Sales → Configuration.')}
        </p>
        {errors.taxRateId ? <p className="text-xs text-red-600">{errors.taxRateId}</p> : null}
      </div>
    </div>
  )
}


function buildVariantCombinations(options: ProductOptionInput[]): Record<string, string>[] {
  if (!options.length) return []
  const [first, ...rest] = options
  const initial = first.values.map((value) => ({ [first.id]: value.label }))
  return rest.reduce<Record<string, string>[]>((acc, option) => {
    const combos: Record<string, string>[] = []
    acc.forEach((partial) => {
      option.values.forEach((value) => {
        combos.push({ ...partial, [option.id]: value.label })
      })
    })
    return combos
  }, initial)
}
