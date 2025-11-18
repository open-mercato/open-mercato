"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Loader2, Search, Image as ImageIcon } from 'lucide-react'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { cn } from '@open-mercato/shared/lib/utils'

type PriceKindSummary = {
  id: string
  code: string | null
  title: string | null
  displayMode: 'including-tax' | 'excluding-tax'
  currencyCode: string | null
}

type PriceOverrideDraft = {
  tempId: string
  priceId?: string | null
  priceKindId?: string | null
  priceKindCode?: string | null
  currencyCode?: string | null
  displayMode?: 'including-tax' | 'excluding-tax' | null
  amount?: string
}

export type OfferFormValues = {
  channelId: string | null
  productId: string | null
  title: string
  description: string
  defaultMediaId: string | null
  isActive: boolean
  priceOverrides: PriceOverrideDraft[]
} & Record<string, unknown>

type ChannelOfferFormProps = {
  channelId?: string
  offerId?: string
  mode: 'create' | 'edit'
}

type OfferResponse = {
  items?: Array<Record<string, unknown>>
}

type PriceResponse = {
  items?: Array<Record<string, unknown>>
}

type AttachmentsResponse = {
  items?: Array<{ id?: string; fileName?: string; url?: string; thumbnailUrl?: string | null }>
}

type ProductSummaryCacheEntry = {
  title: string
  description: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  sku: string | null
  pricing: PricingSummary | null
}

type MediaOption = { id: string; label: string; fileName: string; thumbnailUrl?: string | null }

type PricingSummary = {
  currencyCode: string | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  displayMode: 'including-tax' | 'excluding-tax' | null
}

type ProductVariantPreview = {
  id: string
  name: string
  sku: string | null
  thumbnailUrl: string | null
}

type ProductSummary = ProductSummaryCacheEntry | null

type ProductSearchResult = {
  id: string
  title: string
  sku: string | null
  defaultMediaUrl: string | null
  pricing: PricingSummary | null
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

export function ChannelOfferForm({ channelId: lockedChannelId, offerId, mode }: ChannelOfferFormProps) {
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<OfferFormValues | null>(mode === 'create'
    ? {
        channelId: lockedChannelId ?? null,
        productId: null,
        title: '',
        description: '',
        defaultMediaId: null,
        isActive: true,
        priceOverrides: [],
      }
    : null)
  const [loading, setLoading] = React.useState(mode === 'edit')
  const [error, setError] = React.useState<string | null>(null)
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([])
  const [deletedPriceIds, setDeletedPriceIds] = React.useState<string[]>([])
  const [mediaOptions, setMediaOptions] = React.useState<MediaOption[]>([])
  const attachmentCache = React.useRef<Map<string, MediaOption[]>>(new Map())
  const productCache = React.useRef<Map<string, ProductSummaryCacheEntry>>(new Map())
  const [productSummary, setProductSummary] = React.useState<ProductSummary>(null)
  const [variantPreviews, setVariantPreviews] = React.useState<ProductVariantPreview[]>([])
  const variantCache = React.useRef<Map<string, ProductVariantPreview[]>>(new Map())
  const variantMediaCache = React.useRef<Map<string, string | null>>(new Map())
  const [selectedChannelId, setSelectedChannelId] = React.useState<string | null>(lockedChannelId ?? null)

  React.useEffect(() => {
    if (lockedChannelId) {
      setSelectedChannelId(lockedChannelId)
    } else if (initialValues?.channelId) {
      setSelectedChannelId(initialValues.channelId)
    }
  }, [initialValues?.channelId, lockedChannelId])

  React.useEffect(() => {
    async function loadKinds() {
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          '/api/catalog/price-kinds?pageSize=200',
          undefined,
          { fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        setPriceKinds(items.map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          code: typeof item.code === 'string' ? item.code : null,
          title: typeof item.title === 'string' ? item.title : null,
          currencyCode: typeof item.currencyCode === 'string'
            ? item.currencyCode
            : typeof item.currency_code === 'string'
              ? item.currency_code
              : null,
          displayMode: item.displayMode === 'including-tax' || item.display_mode === 'including-tax'
            ? 'including-tax'
            : 'excluding-tax',
        })))
      } catch (err) {
        console.error('catalog.price-kinds.list', err)
      }
    }
    void loadKinds()
  }, [])

  React.useEffect(() => {
    if (mode !== 'edit' || !offerId) return
    let cancelled = false
    async function loadOffer() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<OfferResponse>(
          `/api/catalog/offers?id=${encodeURIComponent(offerId)}&pageSize=1`,
          undefined,
          { errorMessage: t('sales.channels.offers.errors.loadOffer', 'Failed to load offer.') },
        )
        const offer = Array.isArray(payload.items) ? payload.items[0] : null
        if (!offer) throw new Error('not_found')
        const values = mapOfferToFormValues(offer, lockedChannelId)
        const pricePayload = await readApiResultOrThrow<PriceResponse>(
          `/api/catalog/prices?offerId=${encodeURIComponent(offer.id as string)}&pageSize=200`,
          undefined,
          { fallback: { items: [] } },
        )
        const priceItems = Array.isArray(pricePayload.items) ? pricePayload.items : []
        values.priceOverrides = priceItems.map(mapPriceRow)
        if (!cancelled) setInitialValues(values)
      } catch (err) {
        console.error('sales.channels.offer.load', err)
        if (!cancelled) setError(t('sales.channels.offers.errors.loadOffer', 'Failed to load offer.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadOffer()
    return () => { cancelled = true }
  }, [mode, offerId, lockedChannelId, t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'channelId',
      label: t('sales.channels.offers.form.channel', 'Channel'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => (
        <ChannelSelectInput
          value={(value as string | null) ?? lockedChannelId ?? null}
          onChange={(next) => {
            setValue(next ?? null)
            setSelectedChannelId(next ?? null)
          }}
          disabled={!!lockedChannelId}
          showDetailsLink
        />
      ),
    },
    {
      id: 'productId',
      label: t('sales.channels.offers.form.product', 'Product'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => (
        <ProductSelectInput
          value={(value as string | null) ?? null}
          onChange={(next) => setValue(next)}
          channelId={selectedChannelId}
        />
      ),
    },
    {
      id: 'defaultMediaId',
      label: t('sales.channels.offers.form.defaultMedia', 'Default media'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <DefaultMediaSelect
          value={(value as string | null) ?? null}
          onChange={(next) => setValue(next)}
          options={mediaOptions}
          productThumbnail={productSummary?.defaultMediaUrl ?? null}
        />
      ),
    },
    {
      id: 'title',
      label: t('sales.channels.offers.form.title', 'Title'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('sales.channels.offers.form.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'isActive',
      label: t('sales.channels.offers.form.active', 'Active'),
      type: 'checkbox',
    },
  ], [lockedChannelId, mediaOptions, productSummary?.defaultMediaUrl, selectedChannelId, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'associations', title: t('sales.channels.offers.form.groups.associations', 'Associations'), fields: ['channelId'] },
    {
      id: 'product',
      title: t('sales.channels.offers.form.productGroup', 'Product'),
      description: t('sales.channels.offers.form.productGroupHelp', 'Search the catalog and pick the product you want to customize for this channel.'),
      fields: ['productId'],
    },
    {
      id: 'productSummary',
      title: t('sales.channels.offers.form.productSummaryTitle', 'Product summary'),
      component: () => (
        <ProductOverviewCard summary={productSummary} variants={variantPreviews} />
      ),
    },
    {
      id: 'media',
      title: t('sales.channels.offers.form.mediaGroupTitle', 'Default media override'),
      fields: ['defaultMediaId'],
    },
    { id: 'content', title: t('sales.channels.offers.form.groups.content', 'Content'), fields: ['title', 'description', 'isActive'] },
    {
      id: 'pricing',
      title: t('sales.channels.offers.form.groups.pricing', 'Price overrides'),
      component: ({ values, setValue }) => (
        <PriceOverridesEditor
          values={Array.isArray(values.priceOverrides) ? values.priceOverrides as PriceOverrideDraft[] : []}
          onChange={(next) => setValue('priceOverrides', next)}
          priceKinds={priceKinds}
          onRemove={(priceId) => setDeletedPriceIds((prev) => [...prev, priceId])}
          basePrice={productSummary?.pricing ?? null}
        />
      ),
    },
    {
      id: 'watchers',
      component: ({ values, setValue }) => (
        <OfferFormWatchers
          values={values}
          setValue={setValue}
          productCache={productCache}
          attachmentCache={attachmentCache}
          setMediaOptions={setMediaOptions}
          setProductSummary={setProductSummary}
          setVariantPreviews={setVariantPreviews}
          variantCache={variantCache}
          variantMediaCache={variantMediaCache}
          channelId={selectedChannelId}
        />
      ),
    },
  ], [attachmentCache, priceKinds, productCache, productSummary?.pricing, selectedChannelId, setMediaOptions, t, variantPreviews])

  const handleSubmit = React.useCallback(async (values: OfferFormValues) => {
    const channelId = typeof values.channelId === 'string' && values.channelId.length
      ? values.channelId
      : selectedChannelId ?? lockedChannelId
    const productId = typeof values.productId === 'string' ? values.productId : null
    if (!channelId || !productId) {
      throw new Error(t('sales.channels.offers.errors.requiredFields', 'Choose a channel and product.'))
    }
    const basePayload: Record<string, unknown> = {
      channelId,
      productId,
      title: values.title?.trim() || undefined,
      description: values.description?.trim() || undefined,
      defaultMediaId: typeof values.defaultMediaId === 'string' && values.defaultMediaId.trim().length
        ? values.defaultMediaId
        : undefined,
      isActive: values.isActive !== false,
    }
    const attachmentLookup = attachmentCache.current.get(productId) ?? []
    const mediaMap = new Map(attachmentLookup.map((entry) => [entry.id, entry.fileName]))
    if (basePayload.defaultMediaId && mediaMap.has(basePayload.defaultMediaId as string)) {
      const fileName = mediaMap.get(basePayload.defaultMediaId as string) ?? null
      basePayload.defaultMediaUrl = buildAttachmentImageUrl(basePayload.defaultMediaId as string, {
        slug: slugifyAttachmentFileName(fileName),
      })
    }
    const customFields = collectCustomFieldValues(values)
    if (Object.keys(customFields).length) basePayload.customFields = customFields
    let savedId = offerId ?? null
    if (mode === 'create') {
      const res = await createCrud<{ id?: string; offerId?: string }>('catalog/offers', basePayload, {
        errorMessage: t('sales.channels.offers.errors.save', 'Failed to save offer.'),
      })
      savedId = res?.result?.offerId ?? res?.result?.id ?? null
    } else if (offerId) {
      await updateCrud('catalog/offers', { id: offerId, ...basePayload }, {
        errorMessage: t('sales.channels.offers.errors.save', 'Failed to save offer.'),
      })
      savedId = offerId
    }
    if (savedId) {
      await syncPriceOverrides({
        overrides: Array.isArray(values.priceOverrides) ? values.priceOverrides : [],
        deletedIds: deletedPriceIds,
        offerId: savedId,
        channelId,
        productId,
      })
    }
    flash(t('sales.channels.offers.messages.saved', 'Offer saved.'), 'success')
    router.push(`/backend/sales/channels/${channelId}/edit`)
  }, [attachmentCache, deletedPriceIds, lockedChannelId, mode, offerId, router, selectedChannelId, t])

  const handleDelete = React.useCallback(async () => {
    if (!offerId) return
    await deleteCrud('catalog/offers', offerId, {
      errorMessage: t('sales.channels.offers.errors.delete', 'Failed to delete offer.'),
    })
    flash(t('sales.channels.offers.messages.deleted', 'Offer deleted.'), 'success')
    const targetChannel = initialValues?.channelId ?? lockedChannelId ?? ''
    router.push(`/backend/sales/channels/${targetChannel}/edit`)
  }, [initialValues?.channelId, lockedChannelId, offerId, router, t])

  return (
    <div>
      {error ? (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <CrudForm<OfferFormValues>
        title={mode === 'create'
          ? t('sales.channels.offers.form.createTitle', 'Create offer')
          : t('sales.channels.offers.form.editTitle', 'Edit offer')}
        entityId={E.catalog.catalog_offer}
        fields={fields}
        groups={groups}
        initialValues={initialValues ?? undefined}
        isLoading={loading}
        loadingMessage={t('sales.channels.offers.form.loading', 'Loading offer…')}
        submitLabel={mode === 'create'
          ? t('sales.channels.offers.form.createSubmit', 'Create offer')
          : t('sales.channels.offers.form.updateSubmit', 'Save changes')}
        cancelHref={lockedChannelId ? `/backend/sales/channels/${lockedChannelId}/edit` : '/backend/sales/channels'}
        onSubmit={handleSubmit}
        onDelete={mode === 'edit' ? handleDelete : undefined}
        deleteVisible={mode === 'edit'}
        deleteRedirect={`/backend/sales/channels/${lockedChannelId ?? ''}/edit`}
      />
    </div>
  )
}

function mapOfferToFormValues(item: Record<string, unknown>, lockedChannelId?: string | null): OfferFormValues {
  return {
    channelId: typeof item.channelId === 'string'
      ? item.channelId
      : typeof item.channel_id === 'string'
        ? item.channel_id
        : lockedChannelId ?? null,
    productId: typeof item.productId === 'string'
      ? item.productId
      : typeof item.product_id === 'string'
        ? item.product_id
        : null,
    title: typeof item.title === 'string' ? item.title : '',
    description: typeof item.description === 'string' ? item.description : '',
    defaultMediaId: typeof item.defaultMediaId === 'string'
      ? item.defaultMediaId
      : typeof item.default_media_id === 'string'
        ? item.default_media_id
        : null,
    isActive: item.isActive === true || item.is_active === true,
    priceOverrides: [],
  }
}

function mapPriceRow(row: Record<string, unknown>): PriceOverrideDraft {
  return {
    tempId: String(row.id ?? crypto.randomUUID?.() ?? Math.random()),
    priceId: typeof row.id === 'string' ? row.id : undefined,
    priceKindId: typeof row.priceKindId === 'string'
      ? row.priceKindId
      : typeof row.price_kind_id === 'string'
        ? row.price_kind_id
        : undefined,
    priceKindCode: typeof row.priceKindCode === 'string'
      ? row.priceKindCode
      : typeof row.price_kind_code === 'string'
        ? row.price_kind_code
        : null,
    currencyCode: typeof row.currencyCode === 'string'
      ? row.currencyCode
      : typeof row.currency_code === 'string'
        ? row.currency_code
        : null,
    displayMode: row.displayMode === 'including-tax' || row.display_mode === 'including-tax'
      ? 'including-tax'
      : 'excluding-tax',
    amount: typeof row.unitPriceNet === 'string'
      ? row.unitPriceNet
      : typeof row.unit_price_net === 'string'
        ? row.unit_price_net
        : typeof row.unitPriceGross === 'string'
          ? row.unitPriceGross
          : typeof row.unit_price_gross === 'string'
            ? row.unit_price_gross
            : '',
  }
}

async function syncPriceOverrides(params: {
  overrides: PriceOverrideDraft[]
  deletedIds: string[]
  offerId: string
  channelId: string
  productId: string
}) {
  const { overrides, deletedIds, offerId, channelId, productId } = params
  for (const draft of overrides) {
    if (!draft.priceKindId || !draft.amount) continue
    const amount = Number(draft.amount)
    if (Number.isNaN(amount)) continue
    const payload: Record<string, unknown> = {
      offerId,
      productId,
      channelId,
      priceKindId: draft.priceKindId,
      currencyCode: draft.currencyCode ?? undefined,
    }
    if (draft.displayMode === 'including-tax') {
      payload.unitPriceGross = amount
    } else {
      payload.unitPriceNet = amount
    }
    if (draft.priceId) {
      await updateCrud('catalog/prices', { id: draft.priceId, ...payload })
    } else {
      await createCrud('catalog/prices', payload)
    }
  }
  for (const id of deletedIds) {
    if (!id) continue
    try {
      await deleteCrud('catalog/prices', id)
    } catch (err) {
      console.error('catalog.prices.delete', err)
    }
  }
}

function ChannelSelectInput({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
}) {
  const [options, setOptions] = React.useState<Array<{ id: string; name: string }>>([])
  React.useEffect(() => {
    async function load() {
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          '/api/sales/channels?pageSize=200',
          undefined,
          { fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        setOptions(items.map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          name: typeof item.name === 'string' ? item.name : '',
        })))
      } catch (err) {
        console.error('sales.channels.options', err)
      }
    }
    if (!disabled) void load()
  }, [disabled])

  if (disabled && value) {
    const label = options.find((opt) => opt.id === value)?.name ?? value
    return (
      <div className="rounded border bg-muted px-3 py-2 text-sm">
        {label}
      </div>
    )
  }
  return (
    <select
      className="w-full rounded border px-2 py-2 text-sm"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">— Select channel —</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  )
}

function ProductSelectInput({
  value,
  onChange,
}: {
  value: string | null
  onChange: (next: string | null) => void
}) {
  const [query, setQuery] = React.useState('')
  const [options, setOptions] = React.useState<Array<{ id: string; title: string }>>([])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ pageSize: '25' })
        if (query.trim().length) params.set('search', query.trim())
        const payload = await fetch(`/api/catalog/products?${params.toString()}`, { signal: controller.signal })
        if (!payload.ok) return
        const data = await payload.json()
        const items = Array.isArray(data?.items) ? data.items : []
        if (!cancelled) {
          setOptions(items.map((item: Record<string, unknown>) => ({
            id: typeof item.id === 'string' ? item.id : '',
            title: typeof item.title === 'string' ? item.title : '',
          })))
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error('catalog.products.options', err)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query])

  return (
    <div className="space-y-2">
      <input
        className="w-full rounded border px-2 py-2 text-sm"
        list="product-options"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        placeholder="Product ID"
      />
      <input
        className="w-full rounded border px-2 py-2 text-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search products…"
      />
      <datalist id="product-options">
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.title}</option>
        ))}
      </datalist>
    </div>
  )
}

function DefaultMediaSelect({
  value,
  options,
  onChange,
}: {
  value: string | null
  options: Array<{ id: string; label: string }>
  onChange: (next: string | null) => void
}) {
  return (
    <select
      className="w-full rounded border px-2 py-2 text-sm"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{options.length ? '— Inherit product media —' : 'Select a product first'}</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

function OfferFormWatchers({
  values,
  setValue,
  productCache,
  attachmentCache,
  setMediaOptions,
  setProductSummary,
  setVariantPreviews,
  variantCache,
  variantMediaCache,
  channelId,
}: CrudFormGroupComponentProps & {
  productCache: React.MutableRefObject<Map<string, ProductSummaryCacheEntry>>
  attachmentCache: React.MutableRefObject<Map<string, MediaOption[]>>
  setMediaOptions: React.Dispatch<React.SetStateAction<MediaOption[]>>
  setProductSummary: React.Dispatch<React.SetStateAction<ProductSummary>>
  setVariantPreviews: React.Dispatch<React.SetStateAction<ProductVariantPreview[]>>
  variantCache: React.MutableRefObject<Map<string, ProductVariantPreview[]>>
  variantMediaCache: React.MutableRefObject<Map<string, string | null>>
  channelId: string | null
}) {
  React.useEffect(() => {
    const productId = typeof values.productId === 'string' ? values.productId : null
    if (!productId) {
      setMediaOptions([])
      setProductSummary(null)
      setVariantPreviews([])
      return
    }
    let cancelled = false
    async function load() {
      try {
        const cacheKey = channelId ? `${productId}:${channelId}` : productId
        let summary = productCache.current.get(cacheKey)
        if (!summary) {
          const params = new URLSearchParams({ id: productId, pageSize: '1' })
          if (channelId) params.set('channelId', channelId)
          const payload = await readApiResultOrThrow<OfferResponse>(
            `/api/catalog/products?${params.toString()}`,
            undefined,
            { fallback: { items: [] } },
          )
          const product = Array.isArray(payload.items) ? payload.items[0] : null
          if (product) {
            summary = mapProductSummary(product)
            productCache.current.set(cacheKey, summary)
          }
        }
        if (!cancelled) {
          setProductSummary(summary ?? null)
          if (summary) {
            if (!values.title?.trim() && summary.title) {
              setValue('title', summary.title)
            }
            if (!values.description?.trim() && summary.description) {
              setValue('description', summary.description)
            }
          }
        }
        let attachments = attachmentCache.current.get(productId)
        if (!attachments) {
          const attachmentPayload = await apiCall<AttachmentsResponse>(
            `/api/attachments?entityId=${encodeURIComponent(E.catalog.catalog_product)}&recordId=${encodeURIComponent(productId)}`,
          )
          const items = attachmentPayload.ok && attachmentPayload.result?.items
            ? attachmentPayload.result.items
            : []
          attachments = items
            .filter((item): item is { id: string; fileName: string; thumbnailUrl?: string | null } => (
              typeof item.id === 'string' && typeof item.fileName === 'string'
            ))
            .map((item) => ({
              id: item.id,
              label: item.fileName,
              fileName: item.fileName,
              thumbnailUrl: typeof item.thumbnailUrl === 'string'
                ? item.thumbnailUrl
                : buildAttachmentImageUrl(item.id, {
                    width: 360,
                    height: 360,
                    slug: slugifyAttachmentFileName(item.fileName),
                  }),
            }))
          attachmentCache.current.set(productId, attachments)
        }
        if (!cancelled && attachments) {
          setMediaOptions(attachments)
          if (!values.defaultMediaId && summary?.defaultMediaId) {
            setValue('defaultMediaId', summary.defaultMediaId)
          }
        }
        let variants = variantCache.current.get(productId)
        if (!variants) {
          const variantPayload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
            `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=200`,
            undefined,
            { fallback: { items: [] } },
          )
          const items = Array.isArray(variantPayload.items) ? variantPayload.items : []
          variants = await Promise.all(
            items.map(async (item) => {
              const preview = mapVariantPreview(item)
              const thumbnail = await resolveVariantThumbnail(preview.id, variantMediaCache)
              return { ...preview, thumbnailUrl: thumbnail }
            }),
          )
          variantCache.current.set(productId, variants)
        }
        if (!cancelled && variants) {
          setVariantPreviews(variants)
        }
      } catch (err) {
        console.error('sales.channels.offer.watchers', err)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [
    attachmentCache,
    channelId,
    productCache,
    setMediaOptions,
    setProductSummary,
    setValue,
    setVariantPreviews,
    values.defaultMediaId,
    values.description,
    values.productId,
    values.title,
    variantCache,
    variantMediaCache,
  ])
  return null
}

function mapProductSummary(item: Record<string, unknown>): ProductSummaryCacheEntry {
  const pricingSource = item.pricing && typeof item.pricing === 'object' ? item.pricing as Record<string, unknown> : null
  return {
    title: typeof item.title === 'string' ? item.title : '',
    description: typeof item.description === 'string' ? item.description : null,
    defaultMediaId: typeof item.defaultMediaId === 'string'
      ? item.defaultMediaId
      : typeof item.default_media_id === 'string'
        ? item.default_media_id
        : null,
    defaultMediaUrl: typeof item.defaultMediaUrl === 'string'
      ? item.defaultMediaUrl
      : typeof item.default_media_url === 'string'
        ? item.default_media_url
        : null,
    sku: typeof item.sku === 'string' ? item.sku : null,
    pricing: normalizePricing(pricingSource),
  }
}

function normalizePricing(source: Record<string, unknown> | null): PricingSummary | null {
  if (!source) return null
  const currencyCode = typeof source.currencyCode === 'string'
    ? source.currencyCode
    : typeof source.currency_code === 'string'
      ? source.currency_code
      : null
  const unitPriceNet = typeof source.unitPriceNet === 'string'
    ? source.unitPriceNet
    : typeof source.unit_price_net === 'string'
      ? source.unit_price_net
      : null
  const unitPriceGross = typeof source.unitPriceGross === 'string'
    ? source.unitPriceGross
    : typeof source.unit_price_gross === 'string'
      ? source.unit_price_gross
      : null
  const displayMode = source.displayMode === 'including-tax' || source.display_mode === 'including-tax'
    ? 'including-tax'
    : source.displayMode === 'excluding-tax' || source.display_mode === 'excluding-tax'
      ? 'excluding-tax'
      : null
  return { currencyCode, unitPriceNet, unitPriceGross, displayMode }
}

function mapVariantPreview(item: Record<string, unknown>): ProductVariantPreview {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    name: typeof item.name === 'string'
      ? item.name
      : typeof item.sku === 'string'
        ? item.sku
        : 'Variant',
    sku: typeof item.sku === 'string' ? item.sku : null,
    thumbnailUrl: typeof item.defaultMediaUrl === 'string'
      ? item.defaultMediaUrl
      : typeof item.default_media_url === 'string'
        ? item.default_media_url
        : null,
  }
}

async function resolveVariantThumbnail(
  variantId: string,
  cache: React.MutableRefObject<Map<string, string | null>>,
): Promise<string | null> {
  if (!variantId) return null
  if (cache.current.has(variantId)) {
    return cache.current.get(variantId) ?? null
  }
  try {
    const payload = await apiCall<AttachmentsResponse>(
      `/api/attachments?entityId=${encodeURIComponent(E.catalog.catalog_product_variant)}&recordId=${encodeURIComponent(variantId)}`,
    )
    const items = payload.ok && payload.result?.items ? payload.result.items : []
    const first = items.find((item) => typeof item.id === 'string')
    if (first?.id) {
      const thumbnail = typeof first.thumbnailUrl === 'string'
        ? first.thumbnailUrl
        : buildAttachmentImageUrl(first.id, {
            width: 360,
            height: 360,
            slug: slugifyAttachmentFileName(first.fileName ?? first.id),
          })
      cache.current.set(variantId, thumbnail ?? null)
      return thumbnail ?? null
    }
  } catch (err) {
    console.error('sales.channels.offer.variantMedia', err)
  }
  cache.current.set(variantId, null)
  return null
}

function PriceOverridesEditor({
  values,
  onChange,
  priceKinds,
  onRemove,
  basePrice,
}: {
  values: PriceOverrideDraft[]
  onChange: (next: PriceOverrideDraft[]) => void
  priceKinds: PriceKindSummary[]
  onRemove: (priceId: string) => void
  basePrice: PricingSummary | null
}) {
  const t = useT()
  const addRow = React.useCallback(() => {
    onChange([
      ...values,
      { tempId: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), amount: '' },
    ])
  }, [onChange, values])

  const updateRow = React.useCallback((tempId: string, patch: Partial<PriceOverrideDraft>) => {
    onChange(values.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row)))
  }, [onChange, values])

  const removeRow = React.useCallback((row: PriceOverrideDraft) => {
    if (row.priceId) onRemove(row.priceId)
    onChange(values.filter((entry) => entry.tempId !== row.tempId))
  }, [onChange, onRemove, values])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('sales.channels.offers.pricing.help', 'Provide overrides for price kinds when this offer is active.')}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          {t('sales.channels.offers.pricing.add', 'Add price')}
        </Button>
      </div>
      {values.length ? (
        <div className="space-y-2">
          {values.map((row) => (
            <div key={row.tempId} className="grid gap-2 rounded border p-3 md:grid-cols-3">
              <select
                className="rounded border px-2 py-2 text-sm"
                value={row.priceKindId ?? ''}
                onChange={(event) => {
                  const next = priceKinds.find((kind) => kind.id === event.target.value)
                  updateRow(row.tempId, {
                    priceKindId: next?.id ?? null,
                    priceKindCode: next?.code ?? next?.title ?? null,
                    currencyCode: next?.currencyCode ?? null,
                    displayMode: next?.displayMode ?? null,
                  })
                }}
              >
                <option value="">{t('sales.channels.offers.pricing.selectKind', 'Select price kind')}</option>
                {priceKinds.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.title ?? kind.code ?? kind.id}
                  </option>
                ))}
              </select>
              <input
                className="rounded border px-2 py-2 text-sm"
                type="number"
                placeholder={t('sales.channels.offers.pricing.amount', 'Amount')}
                value={row.amount ?? ''}
                onChange={(event) => updateRow(row.tempId, { amount: event.target.value })}
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{row.currencyCode ?? '—'}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(row)}>
                  {t('sales.channels.offers.pricing.remove', 'Remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('sales.channels.offers.pricing.empty', 'No overrides yet.')}
        </p>
      )}
    </div>
  )
}
