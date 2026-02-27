"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import {
  type VariantFormValues,
  type VariantPriceDraft,
  type OptionDefinition,
  createVariantInitialValues,
  normalizeOptionSchema,
} from '@open-mercato/core/modules/catalog/components/products/variantForm'
import {
  type PriceKindSummary,
  type PriceKindApiPayload,
  type TaxRateSummary,
  normalizePriceKindSummary,
} from '@open-mercato/core/modules/catalog/components/products/productForm'
import {
  VariantBasicsSection,
  VariantOptionValuesSection,
  VariantDimensionsSection,
  VariantMetadataSection,
  VariantPricesSection,
  VariantMediaSection,
} from '@open-mercato/core/modules/catalog/components/products/VariantBuilder'
import type { ProductMediaItem } from '@open-mercato/core/modules/catalog/components/products/ProductMediaManager'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { fetchOptionSchemaTemplate } from '../../../optionSchemaClient'
import CreateVariantPage from '../create/page'

type VariantResponse = {
  items?: Array<Record<string, unknown>>
}

type ProductResponse = {
  items?: Array<{
    id?: string
    title?: string | null
    metadata?: Record<string, unknown> | null
    tax_rate_id?: string | null
    taxRateId?: string | null
    tax_rate?: number | string | null
    taxRate?: number | string | null
  }>
}

type PriceListResponse = {
  items?: Array<Record<string, unknown>>
}

type AttachmentListResponse = {
  items?: ProductMediaItem[]
}

function resolveVariantPriceLabel(prices: Record<string, VariantPriceDraft> | undefined): string | null {
  if (!prices || typeof prices !== 'object') return null
  const entries = Object.values(prices)
  for (const entry of entries) {
    const amount = typeof entry?.amount === 'string' ? entry.amount.trim() : ''
    if (!amount) continue
    const currencyCode =
      typeof entry.currencyCode === 'string' && entry.currencyCode.trim().length
        ? entry.currencyCode.trim().toUpperCase()
        : null
    return currencyCode ? `${currencyCode} ${amount}` : amount
  }
  return null
}

export default function EditVariantPage({ params }: { params?: { productId?: string; variantId?: string } }) {
  const router = useRouter()
  const t = useT()
  const productId = params?.productId ? String(params.productId) : null
  const variantId = params?.variantId ? String(params.variantId) : null
  const isCreateSentinel = variantId === 'create'
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([])
  const [taxRates, setTaxRates] = React.useState<TaxRateSummary[]>([])
  const [optionDefinitions, setOptionDefinitions] = React.useState<OptionDefinition[]>([])
  const [initialValues, setInitialValues] = React.useState<VariantFormValues | null>(null)
  const [existingPriceIds, setExistingPriceIds] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [currentProductId, setCurrentProductId] = React.useState<string | null>(productId)
  const [productTitle, setProductTitle] = React.useState<string>('')
  const [productTaxRateId, setProductTaxRateId] = React.useState<string | null>(null)
  const [productTaxRate, setProductTaxRate] = React.useState<number | null>(null)

  React.useEffect(() => {
    const loadPriceKinds = async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: PriceKindApiPayload[] }>(
          '/api/catalog/price-kinds?pageSize=100',
          undefined,
          { errorMessage: t('catalog.priceKinds.errors.load', 'Failed to load price kinds.') },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        setPriceKinds(items.map((item) => normalizePriceKindSummary(item)).filter((item): item is PriceKindSummary => !!item))
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
    if (!variantId || isCreateSentinel) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const variantRes = await apiCall<VariantResponse>(
          `/api/catalog/variants?id=${encodeURIComponent(variantId!)}&page=1&pageSize=1`,
        )
        if (!variantRes.ok) throw new Error('load_variant_failed')
        const record = Array.isArray(variantRes.result?.items) ? variantRes.result?.items?.[0] : undefined
        if (!record) throw new Error(t('catalog.variants.form.errors.notFound', 'Variant not found.'))
        const resolvedProductId =
          typeof record.product_id === 'string'
            ? record.product_id
            : typeof record.productId === 'string'
              ? record.productId
              : currentProductId
        if (resolvedProductId) setCurrentProductId(resolvedProductId)
        const metadata = typeof record.metadata === 'object' && record.metadata ? { ...(record.metadata as Record<string, unknown>) } : {}
        const attachments = await fetchVariantAttachments(variantId!)
        const priceDrafts = await loadVariantPrices(variantId!)
        const priceIdMap: Record<string, string> = {}
        Object.entries(priceDrafts).forEach(([kindId, draft]) => {
          if (draft.priceId) priceIdMap[kindId] = draft.priceId
        })
        setExistingPriceIds(priceIdMap)
        const customDefaults = extractCustomFieldValues(record)
        let loadedOptionDefinitions: OptionDefinition[] = []
        if (resolvedProductId) {
          const productRes = await apiCall<ProductResponse>(
            `/api/catalog/products?id=${encodeURIComponent(resolvedProductId)}&page=1&pageSize=1`,
          )
          if (productRes.ok) {
            const product = Array.isArray(productRes.result?.items) ? productRes.result?.items?.[0] : undefined
            if (product) {
              setProductTitle(typeof product.title === 'string' ? product.title : '')
              const taxRateId =
                typeof (product as any).tax_rate_id === 'string'
                  ? (product as any).tax_rate_id
                  : typeof (product as any).taxRateId === 'string'
                    ? (product as any).taxRateId
                    : null
              const taxRateValueRaw =
                typeof (product as any).tax_rate === 'number'
                  ? (product as any).tax_rate
                  : typeof (product as any).tax_rate === 'string'
                    ? Number((product as any).tax_rate)
                    : typeof (product as any).taxRate === 'number'
                      ? (product as any).taxRate
                      : typeof (product as any).taxRate === 'string'
                        ? Number((product as any).taxRate)
                        : null
              const taxRateValue = Number.isFinite(taxRateValueRaw) ? Number(taxRateValueRaw) : null
              setProductTaxRateId(taxRateId)
              setProductTaxRate(taxRateValue)
              const productMetadata = (product.metadata ?? {}) as Record<string, unknown>
              const optionSchemaId =
                typeof (product as any).option_schema_id === 'string'
                  ? (product as any).option_schema_id
                  : typeof (product as any).optionSchemaId === 'string'
                    ? (product as any).optionSchemaId
                    : null
              let schemaSource: unknown =
                productMetadata.optionSchema ?? (productMetadata.option_schema as unknown)
              if (optionSchemaId) {
                const template = await fetchOptionSchemaTemplate(optionSchemaId)
                if (template?.schema?.options) {
                  schemaSource = template.schema.options.map((option) => ({
                    code: option.code,
                    label: option.label,
                    values: Array.isArray(option.choices)
                      ? option.choices.map((choice) => ({
                          id: choice.code ?? undefined,
                          label: choice.label ?? choice.code ?? '',
                        }))
                      : [],
                  }))
                }
              }
              loadedOptionDefinitions = normalizeOptionSchema(schemaSource)
              setOptionDefinitions(loadedOptionDefinitions)
            }
          }
        }
        if (!cancelled) {
          const optionValues =
            typeof record.option_values === 'object' && record.option_values
              ? { ...(record.option_values as Record<string, string>) }
              : typeof record.optionValues === 'object' && record.optionValues
                ? { ...(record.optionValues as Record<string, string>) }
                : {}
          const normalizedOptionValues = reconcileOptionValues(optionValues, loadedOptionDefinitions)
          const defaultMediaId =
            typeof record.default_media_id === 'string'
              ? record.default_media_id
              : typeof record.defaultMediaId === 'string'
                ? record.defaultMediaId
                : attachments[0]?.id ?? null
          const defaultMediaUrl =
            typeof record.default_media_url === 'string'
              ? record.default_media_url
              : typeof record.defaultMediaUrl === 'string'
                ? record.defaultMediaUrl
                : ''
          const base = createVariantInitialValues()
          setInitialValues({
            ...base,
            mediaDraftId: variantId!,
            name: typeof record.name === 'string' ? record.name : '',
            sku: typeof record.sku === 'string' ? record.sku : '',
            barcode: typeof record.barcode === 'string' ? record.barcode : '',
            isDefault: record.is_default === true || record.isDefault === true,
            isActive: record.is_active !== false && record.isActive !== false,
            optionValues: normalizedOptionValues,
            metadata,
            mediaItems: attachments,
            defaultMediaId,
            defaultMediaUrl,
            prices: priceDrafts,
            taxRateId:
              typeof (record as any).tax_rate_id === 'string'
                ? (record as any).tax_rate_id
                : typeof (record as any).taxRateId === 'string'
                  ? (record as any).taxRateId
                  : null,
            customFieldsetCode:
              typeof record.custom_fieldset_code === 'string'
                ? record.custom_fieldset_code
                : typeof record.customFieldsetCode === 'string'
                  ? record.customFieldsetCode
                  : null,
            ...customDefaults,
          })
        }
      } catch (err) {
        console.error('catalog.variants.load.failed', err)
        if (!cancelled) {
          const message = err instanceof Error && err.message ? err.message : t('catalog.variants.form.errors.load', 'Failed to load variant.')
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [variantId, t, currentProductId])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const list: CrudFormGroup[] = [
      {
        id: 'general',
        column: 1,
        title: t('catalog.variants.form.nameLabel', 'Name'),
        component: ({ values, setValue, errors }) => (
          <VariantBasicsSection values={values as VariantFormValues} setValue={setValue} errors={errors} />
        ),
      },
      {
        id: 'metadata',
        column: 1,
        title: t('catalog.products.edit.metadata.title', 'Metadata'),
        description: t('catalog.products.edit.metadata.hint', 'Attach structured key/value pairs for integrations.'),
        component: ({ values, setValue }) => (
          <VariantMetadataSection values={values as VariantFormValues} setValue={setValue} showIntro={false} embedded />
        ),
      },
      {
        id: 'prices',
        column: 1,
        title: t('catalog.variants.form.pricesLabel', 'Prices'),
        description: t('catalog.variants.form.pricesHint', 'Populate list prices per price kind.'),
        component: ({ values, setValue }) => (
          <VariantPricesSection
            values={values as VariantFormValues}
            setValue={setValue}
            priceKinds={priceKinds}
            taxRates={taxRates}
            showHeader={false}
            embedded
          />
        ),
      },
      {
        id: 'media',
        column: 1,
        title: t('catalog.variants.form.media', 'Media'),
        component: ({ values, setValue }) => (
          <VariantMediaSection values={values as VariantFormValues} setValue={setValue} showLabel={false} />
        ),
      },
    ]

    if (optionDefinitions.length) {
      list.push({
        id: 'options',
        column: 2,
        title: t('catalog.variants.form.options', 'Option values'),
        component: ({ values, setValue }) => (
          <VariantOptionValuesSection
            values={values as VariantFormValues}
            setValue={setValue}
            optionDefinitions={optionDefinitions}
            showHeading={false}
          />
        ),
      })
    }

    list.push({
      id: 'dimensions',
      column: 2,
      title: t('catalog.variants.form.dimensions', 'Dimensions & weight'),
      component: ({ values, setValue }) => (
        <VariantDimensionsSection values={values as VariantFormValues} setValue={setValue} showHeading={false} />
      ),
    })

    list.push({
      id: 'custom',
      column: 2,
      title: t('catalog.variants.form.customFields', 'Custom attributes'),
      kind: 'customFields',
    })

    return list
  }, [optionDefinitions, priceKinds, t, taxRates])

  if (isCreateSentinel) {
    if (!productId) {
      return (
        <Page>
          <PageBody>
            <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t('catalog.variants.form.errors.productMissing', 'Product identifier is missing.')}
            </div>
          </PageBody>
        </Page>
      )
    }
    return <CreateVariantPage params={{ productId }} />
  }

  if (!variantId || !currentProductId) {
    return (
      <Page>
        <PageBody>
          <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t('catalog.variants.form.errors.variantMissing', 'Variant identifier is missing.')}
          </div>
        </PageBody>
      </Page>
    )
  }

  const formTitle = productTitle
    ? t('catalog.variants.form.editTitleFor', 'Edit variant • {{title}}').replace('{{title}}', productTitle)
    : t('catalog.variants.form.editTitle', 'Edit variant')
  const productVariantsHref = `/backend/catalog/products/${currentProductId}#variants`

  return (
    <Page>
      <PageBody>
        {error ? (
          <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        ) : null}
        <CrudForm<VariantFormValues>
          title={formTitle}
          backHref={productVariantsHref}
          versionHistory={{ resourceKind: 'catalog.variant', resourceId: variantId ? String(variantId) : '' }}
          extraActions={(
            <SendObjectMessageDialog
              object={{
                entityModule: 'catalog',
                entityType: 'variant',
                entityId: variantId,
                previewData: {
                  title:
                    (typeof initialValues?.name === 'string' && initialValues.name.trim().length
                      ? initialValues.name
                      : variantId),
                  metadata: {
                    [t('catalog.variants.form.skuLabel')]:
                      (typeof initialValues?.sku === 'string' && initialValues.sku.trim().length
                        ? initialValues.sku
                        : '-'),
                    [t('catalog.variants.form.pricesLabel')]:
                      resolveVariantPriceLabel(initialValues?.prices) ?? '-',
                  },
                },
              }}
            />
          )}
          fields={[]}
          groups={groups}
          entityId={E.catalog.catalog_product_variant}
          customFieldsetBindings={{ [E.catalog.catalog_product_variant]: { valueKey: 'customFieldsetCode' } }}
          initialValues={initialValues ?? undefined}
          isLoading={loading}
          loadingMessage={t('catalog.variants.form.loading', 'Loading variant...')}
          submitLabel={t('catalog.variants.form.save', 'Save changes')}
          cancelHref={productVariantsHref}
          onSubmit={async (values) => {
            const name = values.name?.trim()
            if (!name) {
              const message = t('catalog.variants.form.errors.nameRequired', 'Provide the variant name.')
              throw createCrudFormError(message, { name: message })
            }
            const resolveTaxRateValue = (taxRateId?: string | null) => {
              if (!taxRateId) return null
              const match = taxRates.find((rate) => rate.id === taxRateId)
              return typeof match?.rate === 'number' && Number.isFinite(match.rate) ? match.rate : null
            }
            const resolvedTaxRateId = values.taxRateId ?? productTaxRateId ?? null
            const resolvedTaxRateValue =
              values.taxRateId && resolvedTaxRateId
                ? resolveTaxRateValue(resolvedTaxRateId)
                : productTaxRateId
                  ? resolveTaxRateValue(productTaxRateId) ?? productTaxRate
                  : productTaxRate ?? null
            const metadata = typeof values.metadata === 'object' && values.metadata ? { ...values.metadata } : {}
            const defaultMediaEntry = values.defaultMediaId
              ? (Array.isArray(values.mediaItems) ? values.mediaItems : []).find((item) => item.id === values.defaultMediaId)
              : null
            const defaultMediaUrl = defaultMediaEntry
              ? buildAttachmentImageUrl(defaultMediaEntry.id, {
                  slug: slugifyAttachmentFileName(defaultMediaEntry.fileName),
                })
              : null
            const payload: Record<string, unknown> = {
              id: variantId,
              productId: currentProductId,
              name,
              sku: values.sku?.trim() || undefined,
              barcode: values.barcode?.trim() || undefined,
              isDefault: Boolean(values.isDefault),
              isActive: values.isActive !== false,
              optionValues: Object.keys(values.optionValues ?? {}).length ? values.optionValues : undefined,
              metadata,
              defaultMediaId: values.defaultMediaId ?? undefined,
              defaultMediaUrl: defaultMediaUrl ?? undefined,
              customFieldsetCode: values.customFieldsetCode?.trim().length ? values.customFieldsetCode : undefined,
              taxRateId: resolvedTaxRateId,
              taxRate: resolvedTaxRateValue,
            }
            const customFields = collectCustomFieldValues(values)
            if (Object.keys(customFields).length) payload.customFields = customFields

            await updateCrud('catalog/variants', payload)
            await syncVariantPricesUpdate({
              priceKinds,
              priceDrafts: values.prices ?? {},
              existingPriceIds,
              productId: currentProductId,
              variantId,
              taxRates,
              taxRateId: values.taxRateId,
              productTaxRateId,
              productTaxRate,
            })
            flash(t('catalog.variants.form.updated', 'Variant updated.'), 'success')
            router.push(productVariantsHref)
          }}
          onDelete={async () => {
            await deleteCrud('catalog/variants', variantId!, {
              errorMessage: t('catalog.variants.form.deleteError', 'Failed to delete variant.'),
            })
            flash(t('catalog.variants.form.deleted', 'Variant deleted.'), 'success')
            router.push(productVariantsHref)
          }}
          deleteRedirect={productVariantsHref}
        />
      </PageBody>
    </Page>
  )
}

function reconcileOptionValues(
  optionValues: Record<string, string>,
  optionDefinitions: OptionDefinition[],
): Record<string, string> {
  if (!optionValues || !optionDefinitions.length) {
    return optionValues ?? {}
  }
  const remaining = new Map(Object.entries(optionValues))
  const normalized: Record<string, string> = {}

  for (const option of optionDefinitions) {
    const code = option.code?.trim()
    if (!code) continue
    if (remaining.has(code)) {
      const value = remaining.get(code)
      if (value !== undefined) {
        normalized[code] = value
      }
      remaining.delete(code)
      continue
    }
    const matchKey = findOptionKeyByValue(remaining, option.values)
    if (matchKey) {
      const value = remaining.get(matchKey)
      if (value !== undefined) {
        normalized[code] = value
      }
      remaining.delete(matchKey)
    }
  }

  remaining.forEach((value, key) => {
    if (normalized[key] === undefined) {
      normalized[key] = value
    }
  })

  return normalized
}

function findOptionKeyByValue(
  candidates: Map<string, string>,
  optionValues: { id: string; label: string }[],
): string | null {
  if (!optionValues.length) return null
  const matches: string[] = []
  candidates.forEach((value, key) => {
    if (optionValues.some((entry) => entry.label === value)) {
      matches.push(key)
    }
  })
  return matches.length === 1 ? matches[0] : null
}

async function fetchVariantAttachments(variantId: string): Promise<ProductMediaItem[]> {
  try {
    const res = await apiCall<AttachmentListResponse>(
      `/api/attachments?entityId=${encodeURIComponent(E.catalog.catalog_product_variant)}&recordId=${encodeURIComponent(variantId)}`,
    )
    if (!res.ok) return []
    return Array.isArray(res.result?.items) ? res.result?.items ?? [] : []
  } catch (err) {
    console.error('catalog.variants.attachments.load', err)
    return []
  }
}

async function loadVariantPrices(variantId: string): Promise<Record<string, VariantPriceDraft>> {
  const drafts: Record<string, VariantPriceDraft> = {}
  const pageSize = 100
  let page = 1
  try {
    while (true) {
      const res = await apiCall<PriceListResponse>(
        `/api/catalog/prices?variantId=${encodeURIComponent(variantId)}&page=${page}&pageSize=${pageSize}`,
      )
      if (!res.ok) break
      const items = Array.isArray(res.result?.items) ? res.result?.items : []
      for (const item of items) {
        const kindId =
          typeof item.price_kind_id === 'string'
            ? item.price_kind_id
            : typeof item.priceKindId === 'string'
              ? item.priceKindId
              : null
        if (!kindId) continue
        const unitNet =
          typeof item.unit_price_net === 'string'
            ? item.unit_price_net
            : typeof item.unitPriceNet === 'string'
              ? item.unitPriceNet
              : null
        const unitGross =
          typeof item.unit_price_gross === 'string'
            ? item.unit_price_gross
            : typeof item.unitPriceGross === 'string'
              ? item.unitPriceGross
              : null
        drafts[kindId] = {
          priceKindId: kindId,
          priceId: typeof item.id === 'string' ? item.id : undefined,
          amount: unitNet ?? unitGross ?? '',
          currencyCode:
            typeof item.currency_code === 'string'
              ? item.currency_code
              : typeof item.currencyCode === 'string'
                ? item.currencyCode
                : null,
          displayMode: unitGross ? 'including-tax' : 'excluding-tax',
        }
      }
      if (items.length < pageSize) break
      page += 1
    }
  } catch (err) {
    console.error('catalog.variants.prices.load', err)
  }
  return drafts
}

function extractCustomFieldValues(record: Record<string, unknown>): Record<string, unknown> {
  const customValues: Record<string, unknown> = {}
  Object.entries(record).forEach(([key, value]) => {
    if (key.startsWith('cf_')) customValues[key] = value
    else if (key.startsWith('cf:')) customValues[`cf_${key.slice(3)}`] = value
  })
  return customValues
}

async function syncVariantPricesUpdate({
  priceKinds,
  priceDrafts,
  existingPriceIds,
  productId,
  variantId,
  taxRates,
  taxRateId,
  productTaxRateId,
  productTaxRate,
}: {
  priceKinds: PriceKindSummary[]
  priceDrafts: Record<string, VariantPriceDraft>
  existingPriceIds: Record<string, string>
  productId: string
  variantId: string
  taxRates: TaxRateSummary[]
  taxRateId: string | null
  productTaxRateId?: string | null
  productTaxRate?: number | null
}): Promise<void> {
  const selectedTaxRate = taxRates.find((rate) => rate.id === taxRateId) ?? null
  const fallbackProductTaxRate =
    !selectedTaxRate && productTaxRateId
      ? taxRates.find((rate) => rate.id === productTaxRateId) ?? null
      : null
  const resolvedTaxRateValue =
    selectedTaxRate?.rate ??
    fallbackProductTaxRate?.rate ??
    (Number.isFinite(productTaxRate ?? null) ? productTaxRate ?? null : null)
  const resolvedTaxRateId = (selectedTaxRate ?? fallbackProductTaxRate)?.id ?? null
  for (const kind of priceKinds) {
    const draft = priceDrafts?.[kind.id]
    const amount = typeof draft?.amount === 'string' ? draft.amount.trim() : ''
    const existingId = draft?.priceId ?? existingPriceIds[kind.id]
    if (!amount) {
      if (existingId) {
        try {
          await deleteCrud('catalog/prices', existingId)
        } catch (err) {
          console.error('catalog.prices.delete', err)
        }
      }
      continue
    }
    const numeric = Number(amount)
    if (Number.isNaN(numeric) || numeric < 0) continue
    const payload: Record<string, unknown> = {
      productId,
      variantId,
      priceKindId: kind.id,
      currencyCode: kind.currencyCode ?? undefined,
    }
    if (resolvedTaxRateId) payload.taxRateId = resolvedTaxRateId
    else if (typeof resolvedTaxRateValue === 'number' && Number.isFinite(resolvedTaxRateValue)) payload.taxRate = resolvedTaxRateValue
    if (kind.displayMode === 'including-tax') payload.unitPriceGross = numeric
    else payload.unitPriceNet = numeric
    if (existingId) {
      await updateCrud('catalog/prices', { id: existingId, ...payload })
    } else {
      await createCrud('catalog/prices', payload)
    }
  }
}
