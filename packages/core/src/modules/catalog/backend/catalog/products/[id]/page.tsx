"use client"

import * as React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { ProductMediaManager, type ProductMediaItem } from '@open-mercato/core/modules/catalog/components/products/ProductMediaManager'
import {
  fetchOptionSchemaTemplate,
  type OptionSchemaRecord,
  type OptionSchemaTemplateSummary,
} from '../optionSchemaClient'
import {
  type ProductFormValues,
  type TaxRateSummary,
  type ProductOptionInput,
  type PriceKindSummary,
  type PriceKindApiPayload,
  productFormSchema,
  createLocalId,
  slugify,
  formatTaxRateLabel,
  buildOptionSchemaDefinition,
  convertSchemaToProductOptions,
  normalizePriceKindSummary,
  buildOptionValuesKey,
  buildVariantCombinations,
} from '@open-mercato/core/modules/catalog/components/products/productForm'
import { MetadataEditor } from '@open-mercato/core/modules/catalog/components/products/MetadataEditor'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { ProductCategorizeSection } from '@open-mercato/core/modules/catalog/components/products/ProductCategorizeSection'
import { AlignLeft, BookMarked, ExternalLink, FileText, Layers, Plus, Save, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

const MarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading editor…</div>,
}) as unknown as React.ComponentType<{ value?: string; height?: number; onChange?: (value?: string) => void; previewOptions?: { remarkPlugins?: unknown[] } }>

type ProductResponse = {
  items?: Array<Record<string, unknown>>
}

type VariantListResponse = {
  items?: VariantSummaryApi[]
}

type VariantSummaryApi = {
  id?: string
  name?: string | null
  sku?: string | null
  is_default?: boolean
  isDefault?: boolean
  metadata?: Record<string, unknown> | null
}

type AttachmentListResponse = {
  items?: {
    id: string
    url: string
    fileName: string
    fileSize: number
    thumbnailUrl?: string | null
  }[]
}

type OptionSchemaTemplateListResponse = {
  items?: OptionSchemaTemplateSummary[]
}

type VariantSummary = {
  id: string
  name: string
  sku: string
  isDefault: boolean
  prices: VariantPriceSummary[]
  optionValues: Record<string, string> | null
}

type VariantPriceListResponse = {
  items?: VariantPriceSummaryApi[]
}

type VariantPriceSummaryApi = {
  id?: string
  variant_id?: string | null
  variantId?: string | null
  price_kind_id?: string | null
  priceKindId?: string | null
  currency_code?: string | null
  currencyCode?: string | null
  unit_price_net?: string | null
  unitPriceNet?: string | null
  unit_price_gross?: string | null
  unitPriceGross?: string | null
}

type VariantPriceSummary = {
  id: string
  variantId: string
  priceKindId: string | null
  currencyCode: string | null
  amount: string | null
  displayMode: 'including-tax' | 'excluding-tax'
}

export default function EditCatalogProductPage({ params }: { params?: { id?: string } }) {
  const productId = params?.id ? String(params.id) : null
  const t = useT()
  const [taxRates, setTaxRates] = React.useState<TaxRateSummary[]>([])
  const [variants, setVariants] = React.useState<VariantSummary[]>([])
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([])
  const [initialValues, setInitialValues] = React.useState<Partial<ProductFormValues> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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
              isDefault: Boolean(
                typeof item.isDefault === 'boolean'
                  ? item.isDefault
                  : typeof item.is_default === 'boolean'
                    ? item.is_default
                    : false,
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

  React.useEffect(() => {
    if (!productId) {
      setLoading(false)
      setError(t('catalog.products.edit.errors.idMissing', 'Product identifier is missing.'))
      return
    }
    let cancelled = false
    async function loadProduct() {
      setLoading(true)
      setError(null)
      try {
        const productRes = await apiCall<ProductResponse>(
          `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1&withDeleted=false`,
        )
        if (!productRes.ok) throw new Error('load_failed')
        const record = Array.isArray(productRes.result?.items) ? productRes.result?.items?.[0] : undefined
        if (!record) throw new Error(t('catalog.products.edit.errors.notFound', 'Product not found.'))
        const metadata = normalizeMetadata(record.metadata)
        const optionSchemaId =
          typeof record.option_schema_id === 'string'
            ? record.option_schema_id
            : typeof (record as any).optionSchemaId === 'string'
              ? (record as any).optionSchemaId
              : null
        const optionSchemaTemplate = optionSchemaId ? await fetchOptionSchemaTemplate(optionSchemaId) : null
        let optionInputs = optionSchemaTemplate?.schema
          ? convertSchemaToProductOptions(optionSchemaTemplate.schema)
          : []
        if (!optionInputs.length) {
          optionInputs = readOptionSchema(metadata)
        }
        const attachments = await fetchAttachments(productId)
        const { customValues } = extractCustomFields(record)
        const defaultMediaId = typeof record.default_media_id === 'string' ? record.default_media_id : (record as any).defaultMediaId ?? null
        const defaultMediaUrl = typeof record.default_media_url === 'string' ? record.default_media_url : (record as any).defaultMediaUrl ?? ''
        const initial: ProductFormValues = {
          title: typeof record.title === 'string' ? record.title : '',
          subtitle: typeof record.subtitle === 'string' ? record.subtitle : '',
          handle: typeof record.handle === 'string' ? record.handle : '',
          description: typeof record.description === 'string' ? record.description : '',
          useMarkdown: Boolean(metadata.__useMarkdown),
          taxRateId: null,
          mediaDraftId: productId,
          mediaItems: attachments,
          defaultMediaId,
          defaultMediaUrl,
          hasVariants: Boolean(record.is_configurable ?? record.isConfigurable),
          options: optionInputs,
          optionSchemaId,
          variants: [],
          metadata,
          customFieldsetCode:
            typeof record.custom_fieldset_code === 'string'
              ? record.custom_fieldset_code
              : typeof (record as any).customFieldsetCode === 'string'
                ? (record as any).customFieldsetCode
                : null,
        }
        if (!cancelled) {
          setInitialValues({ ...initial, ...customValues })
        }
        await loadVariants(productId)
      } catch (err) {
        console.error('catalog.products.edit.load failed', err)
        if (!cancelled) {
          const message = err instanceof Error && err.message
            ? err.message
            : t('catalog.products.edit.errors.load', 'Failed to load product details.')
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadProduct()
    return () => { cancelled = true }
  }, [productId, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadPriceKinds() {
      try {
        const payload = await readApiResultOrThrow<{ items?: PriceKindApiPayload[] }>(
          '/api/catalog/price-kinds?pageSize=100',
          undefined,
          { fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        const summaries = items
          .map((item) => normalizePriceKindSummary(item))
          .filter((entry): entry is PriceKindSummary => !!entry)
        if (!cancelled) {
          setPriceKinds(summaries)
        }
      } catch (err) {
        console.error('catalog.price-kinds.fetch failed', err)
        if (!cancelled) {
          setPriceKinds([])
        }
      }
    }
    loadPriceKinds().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const loadVariants = React.useCallback(async (id: string) => {
    try {
      const [variantsRes, pricesRes] = await Promise.all([
        apiCall<VariantListResponse>(`/api/catalog/variants?productId=${encodeURIComponent(id)}&page=1&pageSize=100`),
        apiCall<VariantPriceListResponse>(`/api/catalog/prices?productId=${encodeURIComponent(id)}&page=1&pageSize=100`),
      ])
      if (!variantsRes.ok) {
        setVariants([])
        return
      }
      const priceMap: Record<string, VariantPriceSummary[]> = {}
      if (pricesRes.ok) {
        const priceItems = Array.isArray(pricesRes.result?.items) ? pricesRes.result?.items : []
        for (const item of priceItems) {
          const summary = mapVariantPriceSummary(item)
          if (!summary) continue
          if (!priceMap[summary.variantId]) {
            priceMap[summary.variantId] = []
          }
          priceMap[summary.variantId].push(summary)
        }
        Object.keys(priceMap).forEach((key) => {
          priceMap[key].sort((a, b) => {
            const left = (a.priceKindId ?? '') + (a.currencyCode ?? '')
            const right = (b.priceKindId ?? '') + (b.currencyCode ?? '')
            return left.localeCompare(right)
          })
        })
      }
      const items = Array.isArray(variantsRes.result?.items) ? variantsRes.result?.items : []
      setVariants(
        items
          .map((variant) => {
            const variantId = typeof variant.id === 'string' ? variant.id : null
            if (!variantId) return null
            const variantRecord = variant as Record<string, unknown>
            const optionValues =
              normalizeVariantOptionValues(variantRecord?.['option_values']) ??
              normalizeVariantOptionValues(variantRecord?.optionValues)
            return {
              id: variantId,
              name: typeof variant.name === 'string' && variant.name.trim().length ? variant.name : variant.sku ?? variantId,
              sku: typeof variant.sku === 'string' ? variant.sku : '',
              isDefault: Boolean(variant.is_default ?? variant.isDefault),
              prices: priceMap[variantId] ?? [],
              optionValues,
            }
          })
          .filter((entry): entry is VariantSummary => !!entry),
      )
    } catch (err) {
      console.error('catalog.variants.fetch failed', err)
      setVariants([])
    }
  }, [])

  const refreshVariants = React.useCallback(async () => {
    if (!productId) return
    await loadVariants(productId)
  }, [loadVariants, productId])

  const fetchAttachments = React.useCallback(async (id: string): Promise<ProductMediaItem[]> => {
    try {
      const res = await apiCall<AttachmentListResponse>(
        `/api/attachments?entityId=${encodeURIComponent(E.catalog.catalog_product)}&recordId=${encodeURIComponent(id)}`,
      )
      if (!res.ok) return []
      return (res.result?.items ?? []).map((item) => ({
        id: item.id,
        url: item.url,
        fileName: item.fileName,
        fileSize: item.fileSize,
        thumbnailUrl: item.thumbnailUrl ?? undefined,
      }))
    } catch (err) {
      console.error('attachments.fetch failed', err)
      return []
    }
  }, [])

function mapVariantPriceSummary(item: VariantPriceSummaryApi | undefined): VariantPriceSummary | null {
  if (!item) return null
  const getString = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length) return value.trim()
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    return null
  }
  const variantId = getString(item.variant_id ?? item.variantId)
  const id = getString(item.id)
  if (!variantId || !id) return null
  const priceKindId = getString(item.price_kind_id ?? item.priceKindId)
  const currencyCode = getString(item.currency_code ?? item.currencyCode)
  const unitGross = getString(item.unit_price_gross ?? item.unitPriceGross)
  const unitNet = getString(item.unit_price_net ?? item.unitPriceNet)
  const amount = unitGross ?? unitNet ?? null
  return {
    id,
    variantId,
    priceKindId,
    currencyCode,
    amount,
    displayMode: unitGross ? 'including-tax' : 'excluding-tax',
  }
}

function normalizeVariantOptionValues(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null
  const result: Record<string, string> = {}
  Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof key === 'string' && typeof value === 'string' && key.trim().length) {
      result[key] = value
    }
  })
  return Object.keys(result).length ? result : null
}

  const handleVariantDeleted = React.useCallback((variantId: string) => {
    setVariants((prev) => prev.filter((variant) => variant.id !== variantId))
  }, [])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      column: 1,
      component: ({ values, setValue, errors }) => (
        <ProductDetailsSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          productId={productId ?? ''}
        />
      ),
    },
    {
      id: 'dimensions',
      column: 1,
      component: ({ values, setValue }) => (
        <ProductDimensionsSection values={values as ProductFormValues} setValue={setValue} />
      ),
    },
    {
      id: 'metadata',
      column: 1,
      component: ({ values, setValue }) => (
        <ProductMetadataSection values={values as ProductFormValues} setValue={setValue} />
      ),
    },
    {
      id: 'options',
      column: 1,
      component: ({ values, setValue }) => (
        <ProductOptionsSection values={values as ProductFormValues} setValue={setValue} />
      ),
    },
    {
      id: 'variants',
      column: 1,
      component: ({ values, setValue, errors }) => (
        <ProductVariantsSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          productId={productId ?? ''}
          variants={variants}
          priceKinds={priceKinds}
          onVariantDeleted={handleVariantDeleted}
          onVariantsReload={refreshVariants}
        />
      ),
    },
    {
      id: 'meta',
      column: 2,
      title: t('catalog.products.create.meta.title', 'Product meta'),
      description: t('catalog.products.create.meta.description', 'Manage subtitle and handle for storefronts.'),
      component: ({ values, setValue, errors }) => (
        <ProductMetaSection values={values as ProductFormValues} setValue={setValue} errors={errors} taxRates={taxRates} />
      ),
    },
    {
      id: 'categorize',
      column: 2,
      title: t('catalog.products.create.organize.title', 'Categorize'),
      description: t('catalog.products.create.organize.description', 'Assign categories, sales channels, and tags.'),
      component: ({ values, setValue, errors }) => (
        <ProductCategorizeSection values={values as ProductFormValues} setValue={setValue} errors={errors} />
      ),
    },
    {
      id: 'custom-fields',
      column: 2,
      title: t('catalog.products.edit.custom.title', 'Custom attributes'),
      kind: 'customFields',
    },
  ], [handleVariantDeleted, priceKinds, productId, t, taxRates, variants])

  const handleSubmit = React.useCallback(async (formValues: ProductFormValues) => {
    if (!productId) {
      throw createCrudFormError(t('catalog.products.edit.errors.idMissing', 'Product identifier is missing.'))
    }
    const parsed = productFormSchema.safeParse(formValues)
    if (!parsed.success) {
      const issues = parsed.error.issues
      const fieldErrors: Record<string, string> = {}
      issues.forEach((issue) => {
        const path = issue.path.join('.') || 'form'
        if (!fieldErrors[path]) fieldErrors[path] = issue.message
      })
      const message = issues[0]?.message ?? t('catalog.products.edit.errors.validation', 'Fix highlighted fields.')
      throw createCrudFormError(message, fieldErrors)
    }
    const values = parsed.data
    const title = values.title?.trim()
    if (!title) {
      const message = t('catalog.products.create.errors.title', 'Provide a product title.')
      throw createCrudFormError(message, { title: message })
    }
    const handle = values.handle?.trim() || undefined
    const description = values.description?.trim() || undefined
    const metadata = buildMetadataPayload(values)
    const defaultMediaId = typeof values.defaultMediaId === 'string' && values.defaultMediaId.trim().length
      ? values.defaultMediaId
      : null
    const defaultMediaEntry = defaultMediaId ? values.mediaItems.find((item) => item.id === defaultMediaId) : null
    const defaultMediaUrl = defaultMediaEntry
      ? buildAttachmentImageUrl(defaultMediaEntry.id, {
          slug: slugifyAttachmentFileName(defaultMediaEntry.fileName),
        })
      : null
    const payload: Record<string, unknown> = {
      id: productId,
      title,
      subtitle: values.subtitle?.trim() || undefined,
      description,
      handle,
      isConfigurable: Boolean(values.hasVariants),
      metadata,
      defaultMediaId: defaultMediaId ?? undefined,
      defaultMediaUrl: defaultMediaUrl ?? undefined,
      customFieldsetCode: values.customFieldsetCode?.trim().length ? values.customFieldsetCode : undefined,
    }
    const optionSchemaDefinition = buildOptionSchemaDefinition(values.options, title)
    if (optionSchemaDefinition) {
      payload.optionSchema = optionSchemaDefinition
    } else if (values.optionSchemaId) {
      payload.optionSchemaId = null
    }
    const customFields = collectCustomFieldValues(values)
    if (Object.keys(customFields).length) {
      payload.customFields = customFields
    }
    await updateCrud('catalog/products', payload)
    flash(t('catalog.products.edit.success', 'Product updated.'), 'success')
  }, [productId, t])

  if (!productId) {
    return (
      <Page>
        <PageBody>
          <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t('catalog.products.edit.errors.idMissing', 'Product identifier is missing.')}
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {error ? (
          <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        ) : null}
        <CrudForm<ProductFormValues>
          title={t('catalog.products.edit.title', 'Edit product')}
          backHref="/backend/catalog/products"
          fields={[]}
          groups={groups}
          entityId={E.catalog.catalog_product}
          customFieldsetBindings={{ [E.catalog.catalog_product]: { valueKey: 'customFieldsetCode' } }}
          initialValues={initialValues ?? undefined}
          isLoading={loading}
          loadingMessage={t('catalog.products.edit.loading', 'Loading product')}
          schema={productFormSchema}
          submitLabel={t('catalog.products.edit.save', 'Save changes')}
          cancelHref="/backend/catalog/products"
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}


type ProductDetailsSectionProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  productId: string
}

type ProductMetaSectionProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  taxRates: TaxRateSummary[]
}

type ProductVariantsSectionProps = CrudFormGroupComponentProps<ProductFormValues> & {
  productId: string
  variants: VariantSummary[]
  priceKinds: PriceKindSummary[]
  onVariantDeleted: (variantId: string) => void
  onVariantsReload?: () => Promise<void> | void
}

function ProductDetailsSection({ values, setValue, errors, productId }: ProductDetailsSectionProps) {
  const t = useT()
  const mediaItems = Array.isArray(values.mediaItems) ? values.mediaItems : []

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

  return (
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
          <Textarea
            className="min-h-[180px]"
            value={values.description}
            onChange={(event) => setValue('description', event.target.value)}
            placeholder={t('catalog.products.create.placeholders.description', 'Describe the product...')}
          />
        )}
      </div>

      <ProductMediaManager
        entityId={E.catalog.catalog_product}
        draftRecordId={values.mediaDraftId || productId}
        items={mediaItems}
        defaultMediaId={values.defaultMediaId ?? null}
        onItemsChange={handleMediaItemsChange}
        onDefaultChange={handleDefaultMediaChange}
      />
    </div>
  )
}

function ProductDimensionsSection({ values, setValue }: CrudFormGroupComponentProps<ProductFormValues>) {
  const t = useT()
  const metadata = normalizeMetadata(values.metadata)
  const dimensionValues = normalizeDimensions(metadata)
  const weightValues = normalizeWeight(metadata)

  return (
    <div className="rounded-lg bg-card p-4">
      <h3 className="text-sm font-semibold">{t('catalog.products.edit.dimensions', 'Dimensions & weight')}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">{t('catalog.products.edit.dimensions.width', 'Width')}</Label>
          <Input type="number" value={dimensionValues.width ?? ''} onChange={(event) => setValue('metadata', applyDimension(metadata, 'width', event.target.value))} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">{t('catalog.products.edit.dimensions.height', 'Height')}</Label>
          <Input type="number" value={dimensionValues.height ?? ''} onChange={(event) => setValue('metadata', applyDimension(metadata, 'height', event.target.value))} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">{t('catalog.products.edit.dimensions.depth', 'Depth')}</Label>
          <Input type="number" value={dimensionValues.depth ?? ''} onChange={(event) => setValue('metadata', applyDimension(metadata, 'depth', event.target.value))} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">{t('catalog.products.edit.dimensions.unit', 'Size unit')}</Label>
          <Input value={dimensionValues.unit ?? ''} onChange={(event) => setValue('metadata', applyDimension(metadata, 'unit', event.target.value))} placeholder="cm" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">{t('catalog.products.edit.weight.value', 'Weight')}</Label>
          <Input type="number" value={weightValues.value ?? ''} onChange={(event) => setValue('metadata', applyWeight(metadata, 'value', event.target.value))} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">{t('catalog.products.edit.weight.unit', 'Weight unit')}</Label>
          <Input value={weightValues.unit ?? ''} onChange={(event) => setValue('metadata', applyWeight(metadata, 'unit', event.target.value))} placeholder="kg" />
        </div>
      </div>
    </div>
  )
}

function ProductMetadataSection({ values, setValue }: CrudFormGroupComponentProps<ProductFormValues>) {
  const metadata = normalizeMetadata(values.metadata)
  const handleMetadataChange = React.useCallback((next: Record<string, unknown>) => {
    setValue('metadata', next)
  }, [setValue])

  return <MetadataEditor value={metadata} onChange={handleMetadataChange} embedded />
}

function ProductOptionsSection({ values, setValue }: CrudFormGroupComponentProps<ProductFormValues>) {
  const t = useT()
  const [schemaDialogOpen, setSchemaDialogOpen] = React.useState(false)
  const [schemaTemplates, setSchemaTemplates] = React.useState<OptionSchemaTemplateSummary[]>([])
  const [schemaLoading, setSchemaLoading] = React.useState(false)
  const [saveSchemaOpen, setSaveSchemaOpen] = React.useState(false)
  const [schemaToEdit, setSchemaToEdit] = React.useState<OptionSchemaTemplateSummary | null>(null)

  const loadSchemas = React.useCallback(async () => {
    setSchemaLoading(true)
    try {
      const res = await apiCall<OptionSchemaTemplateListResponse>('/api/catalog/option-schemas?page=1&pageSize=100')
      if (res.ok) {
        setSchemaTemplates(Array.isArray(res.result?.items) ? res.result?.items ?? [] : [])
      } else {
        setSchemaTemplates([])
      }
    } catch (err) {
      console.error('catalog.option-schemas.list failed', err)
      setSchemaTemplates([])
    } finally {
      setSchemaLoading(false)
    }
  }, [])

  const handleDeleteSchema = React.useCallback(async (id: string) => {
    try {
      await deleteCrud('catalog/option-schemas', id, {
        errorMessage: t('catalog.products.edit.schemas.deleteError', 'Failed to delete schema.'),
      })
      flash(t('catalog.products.edit.schemas.deleted', 'Schema deleted.'), 'success')
      void loadSchemas()
    } catch (err) {
      console.error('catalog.option-schemas.delete failed', err)
    }
  }, [loadSchemas, t])

  const handleSaveSchema = React.useCallback(async (name: string) => {
    if (!name.trim().length) {
      const message = t('catalog.products.edit.schemas.nameRequired', 'Provide a schema name.')
      throw createCrudFormError(message, { name: message })
    }
    const schemaPayload = buildSchemaFromOptions(Array.isArray(values.options) ? values.options : [], name)
    if (!schemaPayload.options.length) {
      throw createCrudFormError(t('catalog.products.edit.schemas.empty', 'Add at least one option before saving.'), {})
    }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      code: slugify(name.trim()),
      schema: schemaPayload,
      isActive: true,
    }
    if (schemaToEdit?.id) payload.id = schemaToEdit.id
    if (schemaToEdit?.id) await updateCrud('catalog/option-schemas', payload)
    else await createCrud('catalog/option-schemas', payload)
    flash(t('catalog.products.edit.schemas.saved', 'Schema saved.'), 'success')
    setSaveSchemaOpen(false)
    setSchemaToEdit(null)
    void loadSchemas()
  }, [schemaToEdit, t, values.options, loadSchemas])

  const handleOptionTitleChange = React.useCallback((optionId: string, nextTitle: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).map((option) =>
      option.id === optionId ? { ...option, title: nextTitle } : option,
    )
    setValue('options', next)
  }, [setValue, values.options])

  const setOptionValues = React.useCallback((optionId: string, labels: string[]) => {
    const normalized = labels.map((label) => label.trim()).filter((label) => label.length)
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
  }, [setValue, values.options])

  const addOption = React.useCallback(() => {
    const next = [
      ...(Array.isArray(values.options) ? values.options : []),
      { id: createLocalId(), title: '', values: [] },
    ]
    setValue('options', next)
  }, [setValue, values.options])

  const removeOption = React.useCallback((optionId: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).filter((option) => option.id !== optionId)
    setValue('options', next)
  }, [setValue, values.options])

  return (
    <>
      <div className="space-y-4 rounded-lg bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('catalog.products.create.optionsBuilder.title', 'Product options')}</h3>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setSchemaDialogOpen(true)
                void loadSchemas()
              }}
              title={t('catalog.products.edit.schemas.manage', 'Open schema library')}
            >
              <BookMarked className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setSchemaToEdit(null)
                setSaveSchemaOpen(true)
              }}
              title={t('catalog.products.edit.schemas.save', 'Save as schema')}
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={addOption}>
              <Plus className="mr-2 h-4 w-4" />
              {t('catalog.products.create.optionsBuilder.add', 'Add option')}
            </Button>
          </div>
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

      <OptionSchemaDialog
        open={schemaDialogOpen}
        onOpenChange={(next) => {
          setSchemaDialogOpen(next)
          if (next) void loadSchemas()
        }}
        isLoading={schemaLoading}
        templates={schemaTemplates}
        onSelect={(template) => {
          setSchemaDialogOpen(false)
          if (!template) return
          const options = extractOptionsFromTemplate(template)
          setValue('options', options)
        }}
        onDelete={handleDeleteSchema}
        onEdit={(template) => {
          setSchemaToEdit(template)
          setSaveSchemaOpen(true)
        }}
      />

      <SaveSchemaDialog
        open={saveSchemaOpen}
        onOpenChange={(next) => {
          setSaveSchemaOpen(next)
          if (!next) setSchemaToEdit(null)
        }}
        defaultName={schemaToEdit?.name ?? ''}
        onSubmit={handleSaveSchema}
      />
    </>
  )
}

function ProductVariantsSection({
  values,
  productId,
  variants,
  priceKinds,
  onVariantDeleted,
  onVariantsReload,
}: ProductVariantsSectionProps) {
  const t = useT()
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const optionDefinitions = React.useMemo(
    () => (Array.isArray(values.options) ? values.options : []),
    [values.options],
  )
  const combos = React.useMemo(() => buildVariantCombinations(optionDefinitions), [optionDefinitions])
  const existingKeys = React.useMemo(() => {
    const set = new Set<string>()
    variants.forEach((variant) => {
      const key = buildOptionValuesKey(variant.optionValues ?? undefined)
      if (key) set.add(key)
    })
    return set
  }, [variants])
  const missingCombos = React.useMemo(
    () =>
      combos.filter((combo) => {
        const key = buildOptionValuesKey(combo)
        if (!key) return false
        return !existingKeys.has(key)
      }),
    [combos, existingKeys],
  )
  const priceKindLookup = React.useMemo(() => {
    const map = new Map<string, PriceKindSummary>()
    for (const kind of priceKinds) {
      map.set(kind.id, kind)
    }
    return map
  }, [priceKinds])
  const formatPriceLabel = React.useCallback(
    (price: VariantPriceSummary): string => {
      const kind = price.priceKindId ? priceKindLookup.get(price.priceKindId) : null
      if (kind?.title) return kind.title
      if (kind?.code) return kind.code.toUpperCase()
      return t('catalog.products.edit.variantList.priceFallback', 'Price')
    },
    [priceKindLookup, t],
  )
  const formatPriceAmount = React.useCallback((price: VariantPriceSummary): string => {
    const amount = typeof price.amount === 'string' && price.amount.trim().length ? price.amount.trim() : ''
    if (!amount) return '—'
    if (!price.currencyCode) return amount
    return `${price.currencyCode.toUpperCase()} ${amount}`
  }, [])
  const handleDeleteVariant = React.useCallback(
    async (variant: VariantSummary) => {
      const label = variant.name || variant.sku || variant.id
      const confirmMessage = t('catalog.products.edit.variantList.deleteConfirm', 'Delete variant "{{name}}"?').replace(
        '{{name}}',
        label,
      )
      if (typeof window !== 'undefined' && !window.confirm(confirmMessage)) {
        return
      }
      setDeletingId(variant.id)
      try {
        await deleteCrud('catalog/variants', variant.id, {
          errorMessage: t('catalog.variants.form.deleteError', 'Failed to delete variant.'),
        })
        flash(t('catalog.variants.form.deleted', 'Variant deleted.'), 'success')
        onVariantDeleted(variant.id)
      } catch (err) {
        console.error('catalog.products.edit.variants.delete', err)
        flash(t('catalog.variants.form.deleteError', 'Failed to delete variant.'), 'error')
      } finally {
        setDeletingId(null)
      }
    },
    [onVariantDeleted, t],
  )
  const handleGenerateVariants = React.useCallback(async () => {
    if (!productId) return
    if (!missingCombos.length) {
      flash(
        t('catalog.products.edit.variantList.generateEmpty', 'All option combinations already exist.'),
        'info',
      )
      return
    }
    setGenerating(true)
    try {
      for (const combo of missingCombos) {
        const title =
          Object.values(combo)
            .map((value) => value?.trim())
            .filter((value) => value && value.length)
            .join(' / ') || t('catalog.products.edit.variantList.defaultTitle', 'Variant')
        await createCrud('catalog/variants', {
          productId,
          name: title,
          optionValues: combo,
          isDefault: false,
          isActive: true,
        })
      }
      flash(t('catalog.products.edit.variantList.generateSuccess', 'Missing variants generated.'), 'success')
      if (onVariantsReload) await onVariantsReload()
    } catch (err) {
      console.error('catalog.products.edit.variantList.generate', err)
      flash(t('catalog.products.edit.variantList.generateError', 'Failed to generate variants.'), 'error')
    } finally {
      setGenerating(false)
    }
  }, [missingCombos, onVariantsReload, productId, t])

  const showGenerateButton = optionDefinitions.length > 0

  return (
    <div className="space-y-3 rounded-lg bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('catalog.products.edit.variants', 'Variants')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {showGenerateButton ? (
            <Button type="button" size="sm" variant="outline" disabled={generating} onClick={() => { void handleGenerateVariants() }}>
              {generating
                ? t('catalog.products.edit.variantList.generating', 'Generating…')
                : t('catalog.products.edit.variantList.generate', 'Generate variants')}
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={`/backend/catalog/products/${productId}/variants/create`}>
              <Plus className="mr-2 h-4 w-4" />
              {t('catalog.products.edit.variants.add', 'Add variant')}
            </Link>
          </Button>
        </div>
      </div>
      {variants.length ? (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full table-auto text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">{t('catalog.products.form.variants', 'Variant')}</th>
                <th className="px-3 py-2 font-normal">SKU</th>
                <th className="px-3 py-2 font-normal">
                  {t('catalog.products.edit.variantList.pricesHeading', 'Prices')}
                </th>
                <th className="px-3 py-2 font-normal">{t('catalog.products.edit.variants.default', 'Default')}</th>
                <th className="px-3 py-2 font-normal text-right">
                  {t('catalog.products.edit.variantList.actions', 'Actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id} className="border-t hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link
                      href={`/backend/catalog/products/${productId}/variants/${variant.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {variant.name || variant.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{variant.sku || '—'}</td>
                  <td className="px-3 py-2">
                    {variant.prices.length ? (
                      <ul className="space-y-1">
                        {variant.prices.map((price) => (
                          <li key={price.id} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{formatPriceLabel(price)}</span>{' '}
                            <span>{formatPriceAmount(price)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('catalog.products.edit.variantList.pricesEmpty', 'No prices yet.')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{variant.isDefault ? t('common.yes', 'Yes') : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/backend/catalog/products/${productId}/variants/${variant.id}`}>
                          {t('catalog.products.list.actions.edit', 'Edit')}
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={deletingId === variant.id}
                        onClick={() => { void handleDeleteVariant(variant) }}
                      >
                        {deletingId === variant.id
                          ? t('catalog.products.edit.variantList.deleting', 'Deleting…')
                          : t('catalog.products.list.actions.delete', 'Delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.edit.variants.empty', 'No variants defined yet.')}
        </p>
      )}
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
        <div className="flex items-center justify-between gap-2">
          <Label>{t('catalog.products.create.meta.handleLabel', 'Handle')}</Label>
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateHandle}
          >
            {t('catalog.products.create.actions.generateHandle', 'Generate')}
          </Button>
        </div>
        <Input
          value={handleValue}
          onChange={handleHandleInputChange}
          placeholder={t('catalog.products.create.placeholders.handle', 'e.g., summer-sneaker')}
          className="font-mono lowercase"
        />
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
            <Layers className="h-4 w-4" />
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
            ? t('catalog.products.create.taxRates.help', 'Applied to prices unless overridden per variant.')
            : t('catalog.products.create.taxRates.empty', 'Define tax classes under Sales → Configuration.')}
        </p>
      </div>
    </div>
  )
}

function normalizeMetadata(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !key.startsWith('cf'))
  return Object.fromEntries(entries)
}

function readOptionSchema(metadata: Record<string, any>): ProductOptionInput[] {
  const raw = Array.isArray(metadata.optionSchema)
    ? metadata.optionSchema
    : Array.isArray(metadata.option_schema)
      ? metadata.option_schema
      : []
  return raw
    .map((option) => {
      if (!option || typeof option !== 'object') return null
      const values = Array.isArray((option as any).values)
        ? (option as any).values
            .map((value: any) =>
              value && typeof value === 'object'
                ? { id: String(value.id ?? createLocalId()), label: typeof value.label === 'string' ? value.label : '' }
                : null,
            )
            .filter((entry): entry is { id: string; label: string } => !!entry)
        : []
      return {
        id: String((option as any).id ?? createLocalId()),
        title: typeof (option as any).title === 'string' ? (option as any).title : '',
        values,
      }
    })
    .filter((entry): entry is ProductOptionInput => !!entry)
}


function extractCustomFields(record: Record<string, unknown>): { customValues: Record<string, unknown> } {
  const customValues: Record<string, unknown> = {}
  Object.entries(record).forEach(([key, value]) => {
    if (key.startsWith('cf_')) customValues[key] = value
    else if (key.startsWith('cf:')) customValues[`cf_${key.slice(3)}`] = value
  })
  return { customValues }
}

const normalizeDimensions = (metadata: Record<string, any>) => {
  const raw = metadata.dimensions
  if (!raw || typeof raw !== 'object') return {}
  return {
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    depth: typeof raw.depth === 'number' ? raw.depth : undefined,
    unit: typeof raw.unit === 'string' ? raw.unit : undefined,
  }
}

const normalizeWeight = (metadata: Record<string, any>) => {
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
  const clone = { ...metadata }
  delete clone.dimensions
  return clone
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
  const clone = { ...metadata }
  delete clone.weight
  return clone
}

const cleanupDimensions = (dims: { width?: number; height?: number; depth?: number; unit?: string }) => {
  const clean: Record<string, unknown> = {}
  if (typeof dims.width === 'number' && Number.isFinite(dims.width)) clean.width = dims.width
  if (typeof dims.height === 'number' && Number.isFinite(dims.height)) clean.height = dims.height
  if (typeof dims.depth === 'number' && Number.isFinite(dims.depth)) clean.depth = dims.depth
  if (typeof dims.unit === 'string' && dims.unit.trim().length) clean.unit = dims.unit
  return Object.keys(clean).length ? clean : null
}

const cleanupWeight = (weight: { value?: number; unit?: string }) => {
  const clean: Record<string, unknown> = {}
  if (typeof weight.value === 'number' && Number.isFinite(weight.value)) clean.value = weight.value
  if (typeof weight.unit === 'string' && weight.unit.trim().length) clean.unit = weight.unit
  return Object.keys(clean).length ? clean : null
}

function buildMetadataPayload(values: ProductFormValues): Record<string, unknown> {
  const metadata = normalizeMetadata(values.metadata)
  metadata.__useMarkdown = values.useMarkdown ?? false
  delete metadata.optionSchema
  delete metadata.option_schema
  return metadata
}

function buildSchemaFromOptions(options: ProductOptionInput[], name: string): OptionSchemaRecord {
  return {
    version: 1,
    name,
    options: options.map((option) => ({
      code: slugify(option.title || createLocalId()),
      label: option.title,
      inputType: 'select',
      choices: option.values.map((value) => ({ code: slugify(value.label || value.id), label: value.label })),
    })),
  }
}

function extractOptionsFromTemplate(template: OptionSchemaTemplateSummary): ProductOptionInput[] {
  const schema = template?.schema
  if (!schema || !Array.isArray(schema.options)) return []
  return convertSchemaToProductOptions(schema)
}

function OptionSchemaDialog({
  open,
  onOpenChange,
  templates,
  isLoading,
  onSelect,
  onDelete,
  onEdit,
}: OptionSchemaDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('catalog.products.edit.schemas.dialogTitle', 'Option schemas')}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-6">
            <DataLoader />
          </div>
        ) : templates.length ? (
          <div className="divide-y rounded-md border">
            {templates.map((template) => {
              const id = typeof template.id === 'string' ? template.id : null
              return (
                <div key={id ?? template.name ?? createLocalId()} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{template.name ?? template.code ?? 'Schema'}</p>
                    {template.description ? (
                      <p className="text-xs text-muted-foreground">{template.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => onSelect(template)}>
                      {t('catalog.products.edit.schemas.apply', 'Apply')}
                    </Button>
                    {id ? (
                      <>
                        <Button type="button" size="icon" variant="ghost" onClick={() => onEdit(template)}>
                          <Save className="h-4 w-4" />
                          <span className="sr-only">{t('catalog.products.edit.schemas.edit', 'Edit schema')}</span>
                        </Button>
                        <Button type="button" size="icon" variant="ghost" onClick={() => void onDelete(id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                          <span className="sr-only">{t('catalog.products.edit.schemas.delete', 'Delete schema')}</span>
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            {t('catalog.products.edit.schemas.empty', 'No saved schemas yet.')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

type OptionSchemaDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: OptionSchemaTemplateSummary[]
  isLoading: boolean
  onSelect: (template: OptionSchemaTemplateSummary | null) => void
  onDelete: (id: string) => Promise<void> | void
  onEdit: (template: OptionSchemaTemplateSummary) => void
}

type SaveSchemaDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultName?: string
  onSubmit: (name: string) => Promise<void>
}

function SaveSchemaDialog({ open, onOpenChange, defaultName = '', onSubmit }: SaveSchemaDialogProps) {
  const t = useT()
  const [name, setName] = React.useState(defaultName)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) setName(defaultName)
  }, [defaultName, open])

  const handleSubmit = React.useCallback(async () => {
    setSaving(true)
    try {
      await onSubmit(name)
      onOpenChange(false)
    } catch (err) {
      console.error('schema.save.failed', err)
    } finally {
      setSaving(false)
    }
  }, [name, onOpenChange, onSubmit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('catalog.products.edit.schemas.saveTitle', 'Save option schema')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="schemaName">{t('catalog.products.edit.schemas.nameLabel', 'Schema name')}</Label>
          <Input id="schemaName" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('catalog.products.edit.schemas.namePlaceholder', 'e.g., Color + Size set')} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
