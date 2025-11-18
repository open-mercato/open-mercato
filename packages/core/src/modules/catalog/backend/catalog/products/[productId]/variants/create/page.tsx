"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
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
import { VariantBuilder } from '@open-mercato/core/modules/catalog/components/products/VariantBuilder'
import type { ProductMediaItem } from '@open-mercato/core/modules/catalog/components/products/ProductMediaManager'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { fetchOptionSchemaTemplate } from '../../../optionSchemaClient'

type ProductResponse = {
  items?: Array<{
    id?: string
    title?: string | null
    metadata?: Record<string, unknown> | null
    custom_fieldset_code?: string | null
    customFieldsetCode?: string | null
  }>
}

type VariantCreateResult = {
  id?: string
  variantId?: string
}

export default function CreateVariantPage({ params }: { params?: { productId?: string } }) {
  const productId = params?.productId ? String(params.productId) : null
  const t = useT()
  const router = useRouter()
  const [optionDefinitions, setOptionDefinitions] = React.useState<OptionDefinition[]>([])
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([])
  const [taxRates, setTaxRates] = React.useState<TaxRateSummary[]>([])
  const [initialValues, setInitialValues] = React.useState<VariantFormValues | null>(null)
  const [productTitle, setProductTitle] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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
    if (!productId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await apiCall<ProductResponse>(
          `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
        )
        if (!res.ok) throw new Error('load_failed')
        const record = Array.isArray(res.result?.items) ? res.result?.items?.[0] : undefined
        if (!record) throw new Error(t('catalog.products.edit.errors.notFound', 'Product not found.'))
        const metadata = (record.metadata ?? {}) as Record<string, unknown>
        const optionSchemaId =
          typeof record.option_schema_id === 'string'
            ? record.option_schema_id
            : typeof (record as any).optionSchemaId === 'string'
              ? (record as any).optionSchemaId
              : null
        let schemaSource: unknown = metadata.optionSchema ?? (metadata.option_schema as unknown)
        if (optionSchemaId) {
          const template = await fetchOptionSchemaTemplate(optionSchemaId)
          if (template?.schema?.options) {
            schemaSource = template.schema.options.map((option) => ({
              code: option.code,
              label: option.label,
              values: Array.isArray(option.choices)
                ? option.choices.map((choice) => ({ id: choice.code ?? undefined, label: choice.label ?? choice.code ?? '' }))
                : [],
            }))
          }
        }
        if (!cancelled) {
          setOptionDefinitions(normalizeOptionSchema(schemaSource))
          setProductTitle(typeof record.title === 'string' ? record.title : '')
          const base = createVariantInitialValues()
          setInitialValues(base)
        }
      } catch (err) {
        console.error('catalog.variants.loadProduct failed', err)
        if (!cancelled) {
          const message = err instanceof Error && err.message ? err.message : t('catalog.variants.form.errors.load', 'Failed to load product context.')
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [productId, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'builder',
      column: 1,
      component: ({ values, setValue, errors }) => (
        <VariantBuilder
          values={values as VariantFormValues}
          setValue={setValue}
          errors={errors}
          optionDefinitions={optionDefinitions}
          priceKinds={priceKinds}
          taxRates={taxRates}
        />
      ),
    },
    {
      id: 'custom',
      column: 2,
      title: t('catalog.variants.form.customFields', 'Custom attributes'),
      kind: 'customFields',
    },
  ], [optionDefinitions, priceKinds, t, taxRates])

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

  const formTitle = productTitle
    ? t('catalog.variants.form.createTitleFor', 'Create variant for {{title}}').replace('{{title}}', productTitle)
    : t('catalog.variants.form.createTitle', 'Create variant')

  return (
    <Page>
      <PageBody>
        {error ? (
          <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        ) : null}
        <CrudForm<VariantFormValues>
          title={formTitle}
          backHref={`/backend/catalog/products/${productId}`}
          fields={[]}
          groups={groups}
          entityId={E.catalog.catalog_product_variant}
          customFieldsetBindings={{ [E.catalog.catalog_product_variant]: { valueKey: 'customFieldsetCode' } }}
          initialValues={initialValues ?? undefined}
          isLoading={loading}
          loadingMessage={t('catalog.variants.form.loading', 'Loading form...')}
          submitLabel={t('catalog.variants.form.createAction', 'Create variant')}
          cancelHref={`/backend/catalog/products/${productId}`}
          onSubmit={async (values) => {
            const name = values.name?.trim()
            if (!name) {
              const message = t('catalog.variants.form.errors.nameRequired', 'Provide the variant name.')
              throw createCrudFormError(message, { name: message })
            }
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
              productId,
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
            }
            const customFields = collectCustomFieldValues(values)
            if (Object.keys(customFields).length) payload.customFields = customFields

            const { result } = await createCrud<VariantCreateResult>('catalog/variants', payload)
            const variantId = result?.variantId ?? result?.id
            if (!variantId) {
              throw createCrudFormError(t('catalog.variants.form.errors.idMissing', 'Variant id missing after create.'))
            }
            await transferVariantMedia({
              draftId: values.mediaDraftId,
              variantId,
              mediaItems: Array.isArray(values.mediaItems) ? values.mediaItems : [],
            })
            await syncVariantPrices({
              priceKinds,
              priceDrafts: values.prices ?? {},
              productId,
              variantId,
              taxRates,
              taxRateId: values.taxRateId,
            })
            flash(t('catalog.variants.form.createSuccess', 'Variant created.'), 'success')
            router.push(`/backend/catalog/products/${productId}/variants/${variantId}`)
          }}
        />
      </PageBody>
    </Page>
  )
}

async function transferVariantMedia({
  draftId,
  variantId,
  mediaItems,
}: {
  draftId?: string | null
  variantId: string
  mediaItems: ProductMediaItem[]
}): Promise<void> {
  if (!draftId || !variantId) return
  const attachmentIds = mediaItems.map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!attachmentIds.length) return
  await apiCall(
    '/api/attachments/transfer',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityId: E.catalog.catalog_product_variant,
        attachmentIds,
        fromRecordId: draftId,
        toRecordId: variantId,
      }),
    },
    { fallback: null },
  )
}

async function syncVariantPrices({
  priceKinds,
  priceDrafts,
  productId,
  variantId,
  taxRates,
  taxRateId,
}: {
  priceKinds: PriceKindSummary[]
  priceDrafts: Record<string, VariantPriceDraft>
  productId: string
  variantId: string
  taxRates: TaxRateSummary[]
  taxRateId: string | null
}): Promise<void> {
  const selectedTaxRate = taxRates.find((rate) => rate.id === taxRateId) ?? null
  for (const kind of priceKinds) {
    const draft = priceDrafts?.[kind.id]
    const amount = typeof draft?.amount === 'string' ? draft.amount.trim() : ''
    if (!amount) continue
    const numeric = Number(amount)
    if (Number.isNaN(numeric) || numeric < 0) continue
    const payload: Record<string, unknown> = {
      productId,
      variantId,
      priceKindId: kind.id,
      currencyCode: kind.currencyCode ?? undefined,
    }
    if (selectedTaxRate?.id) {
      payload.taxRateId = selectedTaxRate.id
    } else if (typeof selectedTaxRate?.rate === 'number' && Number.isFinite(selectedTaxRate.rate)) {
      payload.taxRate = selectedTaxRate.rate
    }
    if (kind.displayMode === 'including-tax') payload.unitPriceGross = numeric
    else payload.unitPriceNet = numeric
    await createCrud('catalog/prices', payload)
  }
}
