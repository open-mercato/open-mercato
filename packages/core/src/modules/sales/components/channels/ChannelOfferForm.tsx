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
  defaultMediaId?: string | null
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
const MAX_LIST_PAGE_SIZE = 100

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
  const manualMediaSelections = React.useRef<Set<string>>(new Set())
  const [currentProductId, setCurrentProductId] = React.useState<string | null>(null)
  const channelOffersHref = React.useMemo(
    () => buildChannelOffersHref(lockedChannelId),
    [lockedChannelId],
  )

  React.useEffect(() => {
    if (lockedChannelId) {
      setSelectedChannelId(lockedChannelId)
    } else if (initialValues?.channelId) {
      setSelectedChannelId(initialValues.channelId)
    }
  }, [initialValues?.channelId, lockedChannelId])

  React.useEffect(() => {
    if (typeof initialValues?.productId === 'string') {
      setCurrentProductId(initialValues.productId)
    }
  }, [initialValues?.productId])

  React.useEffect(() => {
    if (typeof initialValues?.productId === 'string' && initialValues?.defaultMediaId === null) {
      manualMediaSelections.current.add(initialValues.productId)
    }
  }, [initialValues?.defaultMediaId, initialValues?.productId])

  React.useEffect(() => {
    async function loadKinds() {
      const mapItems = (items: Array<Record<string, unknown>>) => items.map((item) => ({
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
      }))
      const endpoints = [
        `/api/sales/price-kinds?pageSize=${MAX_LIST_PAGE_SIZE}`,
        `/api/catalog/price-kinds?pageSize=${MAX_LIST_PAGE_SIZE}`,
      ]
      try {
        for (const endpoint of endpoints) {
          try {
            const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
              endpoint,
              undefined,
              { fallback: { items: [] } },
            )
            const items = Array.isArray(payload.items) ? payload.items : []
            setPriceKinds(mapItems(items))
            return
          } catch (err) {
            console.error('sales.channels.price-kinds.fetch', { endpoint, err })
          }
        }
        setPriceKinds([])
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
          `/api/catalog/prices?offerId=${encodeURIComponent(offer.id as string)}&pageSize=${MAX_LIST_PAGE_SIZE}`,
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
          value={(value as string | null | undefined) ?? null}
          onChange={(next) => {
            setValue(next)
            if (!currentProductId) return
            if (next === null || next === undefined) {
              manualMediaSelections.current.add(currentProductId)
            } else {
              manualMediaSelections.current.delete(currentProductId)
            }
          }}
          options={mediaOptions}
          productThumbnail={productSummary?.defaultMediaUrl ?? null}
          hasProduct={Boolean(productSummary)}
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
  ], [lockedChannelId, mediaOptions, productSummary?.defaultMediaUrl, selectedChannelId, t, currentProductId])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'associations', column: 1, title: t('sales.channels.offers.form.groups.associations', 'Associations'), fields: ['channelId'] },
    {
      id: 'product',
      column: 1,
      title: t('sales.channels.offers.form.productGroup', 'Product'),
      description: t('sales.channels.offers.form.productGroupHelp', 'Search the catalog and pick the product you want to customize for this channel.'),
      fields: ['productId'],
    },
    {
      id: 'productSummary',
      column: 2,
      title: t('sales.channels.offers.form.productSummaryTitle', 'Product summary'),
      component: () => (
        <ProductOverviewCard summary={productSummary} variants={variantPreviews} />
      ),
    },
    {
      id: 'media',
      column: 1,
      title: t('sales.channels.offers.form.mediaGroupTitle', 'Default media override'),
      fields: ['defaultMediaId'],
    },
    { id: 'content', column: 1, title: t('sales.channels.offers.form.groups.content', 'Content'), fields: ['title', 'description', 'isActive'] },
    {
      id: 'pricing',
      column: 1,
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
      id: 'customFields',
      column: 2,
      title: t('entities.customFields.title', 'Custom attributes'),
      kind: 'customFields',
    },
    {
      id: 'watchers',
      column: 1,
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
          manualMediaSelections={manualMediaSelections}
          setCurrentProductId={setCurrentProductId}
        />
      ),
    },
  ], [attachmentCache, manualMediaSelections, priceKinds, productCache, productSummary?.pricing, selectedChannelId, setMediaOptions, setCurrentProductId, t, variantPreviews])

  const handleSubmit = React.useCallback(async (values: OfferFormValues) => {
    const channelId = typeof values.channelId === 'string' && values.channelId.length
      ? values.channelId
      : selectedChannelId ?? lockedChannelId
    const productId = typeof values.productId === 'string' ? values.productId : null
    if (!channelId || !productId) {
      throw new Error(t('sales.channels.offers.errors.requiredFields', 'Choose a channel and product.'))
    }
    const resolvedDefaultMediaId = typeof values.defaultMediaId === 'string' && values.defaultMediaId.trim().length
      ? values.defaultMediaId
      : values.defaultMediaId === null
        ? null
        : undefined
    const basePayload: Record<string, unknown> = {
      channelId,
      productId,
      title: values.title?.trim() || undefined,
      description: values.description?.trim() || undefined,
      isActive: values.isActive !== false,
    }
    if (resolvedDefaultMediaId !== undefined) {
      basePayload.defaultMediaId = resolvedDefaultMediaId
    }
    const attachmentLookup = attachmentCache.current.get(productId) ?? []
    const mediaMap = new Map(attachmentLookup.map((entry) => [entry.id, entry.fileName]))
    if (typeof resolvedDefaultMediaId === 'string' && mediaMap.has(resolvedDefaultMediaId)) {
      const fileName = mediaMap.get(resolvedDefaultMediaId) ?? null
      basePayload.defaultMediaUrl = buildAttachmentImageUrl(resolvedDefaultMediaId, {
        slug: slugifyAttachmentFileName(fileName),
      })
    } else if (resolvedDefaultMediaId === null) {
      basePayload.defaultMediaUrl = null
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
    router.push(buildChannelOffersHref(channelId))
  }, [attachmentCache, deletedPriceIds, lockedChannelId, mode, offerId, router, selectedChannelId, t])

  const handleDelete = React.useCallback(async () => {
    if (!offerId) return
    await deleteCrud('catalog/offers', offerId, {
      errorMessage: t('sales.channels.offers.errors.delete', 'Failed to delete offer.'),
    })
    flash(t('sales.channels.offers.messages.deleted', 'Offer deleted.'), 'success')
    const targetChannel = initialValues?.channelId ?? lockedChannelId ?? ''
    router.push(buildChannelOffersHref(targetChannel))
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
        cancelHref={channelOffersHref}
        backHref={channelOffersHref}
        onSubmit={handleSubmit}
        onDelete={mode === 'edit' ? handleDelete : undefined}
        deleteVisible={mode === 'edit'}
        deleteRedirect={channelOffersHref}
      />
    </div>
  )
}

function mapOfferToFormValues(item: Record<string, unknown>, lockedChannelId?: string | null): OfferFormValues {
  const values: OfferFormValues = {
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
  mergeCustomFieldValues(values, item)
  return values
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

function mergeCustomFieldValues(target: Record<string, unknown>, source: Record<string, unknown> | null | undefined) {
  if (!source || typeof source !== 'object') return
  const assign = (key: string | null | undefined, value: unknown) => {
    if (!key) return
    target[`cf_${key}`] = value
  }
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (rawKey.startsWith('cf_')) {
      if (rawKey.endsWith('__is_multi')) continue
      target[rawKey] = rawValue
    } else if (rawKey.startsWith('cf:')) {
      assign(rawKey.slice(3), rawValue)
    }
  }
  const customValues =
    (source as Record<string, unknown>).customValues ??
    (source as Record<string, unknown>).custom_values
  if (customValues && typeof customValues === 'object' && !Array.isArray(customValues)) {
    for (const [key, value] of Object.entries(customValues as Record<string, unknown>)) {
      assign(key, value)
    }
  }
  const customFields =
    (source as Record<string, unknown>).customFields ??
    (source as Record<string, unknown>).custom_fields
  if (Array.isArray(customFields)) {
    customFields.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const key = typeof (entry as Record<string, unknown>).key === 'string'
        ? (entry as Record<string, unknown>).key
        : null
      if (!key) return
      assign(key, (entry as Record<string, unknown>).value)
    })
  } else if (customFields && typeof customFields === 'object') {
    for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
      assign(key, value)
    }
  }
  const customEntries =
    (source as Record<string, unknown>).customFieldEntries ??
    (source as Record<string, unknown>).custom_field_entries
  if (Array.isArray(customEntries)) {
    customEntries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const key = typeof (entry as Record<string, unknown>).key === 'string'
        ? (entry as Record<string, unknown>).key
        : null
      if (!key) return
      assign(key, (entry as Record<string, unknown>).value)
    })
  }
}

function buildChannelOffersHref(channelId?: string | null): string {
  return channelId && channelId.length
    ? `/backend/sales/channels/${channelId}/edit?tab=offers`
    : '/backend/sales/channels/offers'
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
  showDetailsLink,
}: {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  showDetailsLink?: boolean
}) {
  const t = useT()
  const [options, setOptions] = React.useState<Array<{ id: string; name: string; code: string | null }>>([])
  const selectedOption = React.useMemo(
    () => (value ? options.find((opt) => opt.id === value) ?? null : null),
    [options, value],
  )
  React.useEffect(() => {
    async function load() {
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/sales/channels?pageSize=${MAX_LIST_PAGE_SIZE}`,
          undefined,
          { fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        setOptions(items.map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          name: typeof item.name === 'string' ? item.name : '',
          code: typeof item.code === 'string' ? item.code : null,
        })))
      } catch (err) {
        console.error('sales.channels.options', err)
      }
    }
    void load()
  }, [])
  React.useEffect(() => {
    if (!value || selectedOption) return
    let cancelled = false
    async function loadSingle() {
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/sales/channels?id=${encodeURIComponent(value)}&pageSize=1`,
          undefined,
          { fallback: { items: [] } },
        )
        const item = Array.isArray(payload.items) ? payload.items[0] : null
        if (!item || cancelled) return
        const entry = {
          id: typeof item.id === 'string' ? item.id : value,
          name: typeof item.name === 'string' ? item.name : value,
          code: typeof item.code === 'string' ? item.code : null,
        }
        setOptions((prev) => {
          if (prev.some((opt) => opt.id === entry.id)) return prev
          return [...prev, entry]
        })
      } catch (err) {
        console.error('sales.channels.lookup', err)
      }
    }
    void loadSingle()
    return () => { cancelled = true }
  }, [selectedOption, value])

  if (disabled && value) {
    const label = selectedOption?.name ?? value
    const detail = selectedOption?.code ?? null
    return (
      <div className="flex items-center justify-between gap-3 rounded border bg-muted px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="font-medium truncate">{label}</div>
          {detail ? (
            <div className="text-xs text-muted-foreground truncate">{detail}</div>
          ) : null}
        </div>
        {showDetailsLink ? (
          <Link href={`/backend/sales/channels/${value}/edit`} className="text-xs font-medium text-primary hover:underline">
            {t('sales.channels.offers.form.channelDetails', 'Details')}
          </Link>
        ) : null}
      </div>
    )
  }
  return (
    <select
      className="w-full rounded border px-2 py-2 text-sm"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{t('sales.channels.offers.form.channelPlaceholder', 'Select channel')}</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.code ? `${opt.name} (${opt.code})` : opt.name}
        </option>
      ))}
    </select>
  )
}

function ProductSelectInput({
  value,
  onChange,
  channelId,
}: {
  value: string | null
  onChange: (next: string | null) => void
  channelId: string | null
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<ProductSearchResult[]>([])
  const [isLoading, setLoading] = React.useState(false)
  const [hasTyped, setHasTyped] = React.useState(false)

  const trimmed = query.trim()
  const shouldSearch = trimmed.length >= 2 || UUID_REGEX.test(trimmed)

  React.useEffect(() => {
    if (!shouldSearch) {
      setResults([])
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ pageSize: '10' })
        if (UUID_REGEX.test(trimmed)) {
          params.set('id', trimmed)
        } else if (trimmed.length) {
          params.set('search', trimmed)
        }
        if (channelId) params.set('channelId', channelId)
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/catalog/products?${params.toString()}`,
          { signal: controller.signal },
          { fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        if (!cancelled) {
          setResults(items.map(mapProductSearchResult))
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error('catalog.products.lookup', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [channelId, shouldSearch, trimmed])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && UUID_REGEX.test(trimmed)) {
      event.preventDefault()
      onChange(trimmed)
    }
  }, [onChange, trimmed])

  const selectedHint = value
    ? t('sales.channels.offers.form.productSelectedHint', 'Selected product ID: {{id}}', { id: value })
    : null

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          className="w-full rounded border pl-8 pr-2 py-2 text-sm"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHasTyped(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('sales.channels.offers.form.productSearchPlaceholder', 'Search by title, SKU, or ID…')}
        />
      </div>
      {selectedHint ? (
        <div className="rounded border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {selectedHint}
        </div>
      ) : null}
      {value ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t('sales.channels.offers.form.productClear', 'Clear selection')}
        </Button>
      ) : null}
      {shouldSearch ? (
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('sales.channels.offers.form.productSearchLoading', 'Searching products…')}
            </div>
          ) : null}
          {!isLoading && !results.length ? (
            <p className="text-xs text-muted-foreground">
              {t('sales.channels.offers.form.productSearchEmpty', 'No products match your search.')}
            </p>
          ) : null}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {results.map((product) => {
              const isSelected = value === product.id
              return (
                <div
                  key={product.id}
                  className={cn(
                    'flex gap-3 rounded border bg-card p-3 transition-colors',
                    isSelected ? 'border-primary/70 bg-primary/5' : 'hover:border-primary/50',
                  )}
                >
                  <div className="h-12 w-12 overflow-hidden rounded border bg-muted">
                    {product.defaultMediaUrl ? (
                      <img src={product.defaultMediaUrl} alt={product.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{product.title || t('sales.channels.offers.form.productUntitled', 'Untitled product')}</div>
                        {product.sku ? (
                          <div className="text-xs text-muted-foreground">SKU · {product.sku}</div>
                        ) : null}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground">
                        {product.pricing ? formatPriceDisplay(product.pricing) : t('sales.channels.offers.form.productPriceMissing', 'No price')}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant={isSelected ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => onChange(product.id)}
                      >
                        {isSelected
                          ? t('sales.channels.offers.form.productSelected', 'Selected')
                          : t('sales.channels.offers.form.productSelect', 'Select')}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : hasTyped ? (
        <p className="text-xs text-muted-foreground">
          {t('sales.channels.offers.form.productSearchHint', 'Type at least 2 characters or paste a product ID.')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('sales.channels.offers.form.productSearchIntro', 'Search by name or paste the product id to find catalog items.')}
        </p>
      )}
    </div>
  )
}

function DefaultMediaSelect({
  value,
  options,
  onChange,
  productThumbnail,
  hasProduct,
}: {
  value: string | null
  options: MediaOption[]
  onChange: (next: string | null) => void
  productThumbnail: string | null
  hasProduct: boolean
}) {
  const t = useT()
  const hasAttachmentOptions = options.length > 0
  const showPlaceholder = !hasAttachmentOptions && !productThumbnail && !hasProduct
  if (showPlaceholder) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('sales.channels.offers.form.mediaSelectProduct', 'Select a product to load its media.')}
      </p>
    )
  }
  const tiles = [
    {
      id: 'inherit',
      label: t('sales.channels.offers.form.mediaInherit', 'Use product default'),
      thumbnail: productThumbnail,
      selected: value == null,
      onClick: () => onChange(null),
    },
    ...options.map((opt) => ({
      id: opt.id,
      label: opt.label,
      thumbnail: opt.thumbnailUrl ?? null,
      selected: value === opt.id,
      onClick: () => onChange(opt.id),
    })),
  ]
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        <p>
          {t('sales.channels.offers.form.mediaHelp', 'Choose the thumbnail that should represent this offer in the channel.')}
        </p>
        {!hasAttachmentOptions && hasProduct ? (
          <p className="mt-1">
            {t('sales.channels.offers.form.mediaEmpty', 'This product has no uploaded media yet; the product default will be used.')}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={cn(
              'flex flex-col rounded border text-left transition-colors',
              tile.selected ? 'border-primary shadow-sm' : 'hover:border-primary/60',
            )}
            onClick={tile.onClick}
          >
            <div className="relative aspect-square overflow-hidden rounded-t bg-muted">
              {tile.thumbnail ? (
                <img src={tile.thumbnail} alt={tile.label} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              {tile.selected ? (
                <div className="absolute right-2 top-2 rounded-full bg-primary/90 px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  {t('sales.channels.offers.form.mediaSelected', 'Active')}
                </div>
              ) : null}
            </div>
            <div className="p-2">
              <div className="line-clamp-2 text-xs font-medium">{tile.label}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
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
  manualMediaSelections,
  setCurrentProductId,
}: CrudFormGroupComponentProps & {
  productCache: React.MutableRefObject<Map<string, ProductSummaryCacheEntry>>
  attachmentCache: React.MutableRefObject<Map<string, MediaOption[]>>
  setMediaOptions: React.Dispatch<React.SetStateAction<MediaOption[]>>
  setProductSummary: React.Dispatch<React.SetStateAction<ProductSummary>>
  setVariantPreviews: React.Dispatch<React.SetStateAction<ProductVariantPreview[]>>
  variantCache: React.MutableRefObject<Map<string, ProductVariantPreview[]>>
  variantMediaCache: React.MutableRefObject<Map<string, string | null>>
  channelId: string | null
  manualMediaSelections: React.MutableRefObject<Set<string>>
  setCurrentProductId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const previousProductIdRef = React.useRef<string | null>(null)
  const initializedProductRef = React.useRef(false)
  React.useEffect(() => {
    const productId = typeof values.productId === 'string' ? values.productId : null
    setCurrentProductId(productId)
    if (!productId) {
      setMediaOptions([])
      setProductSummary(null)
      setVariantPreviews([])
      previousProductIdRef.current = null
      return
    }
    if (!initializedProductRef.current) {
      previousProductIdRef.current = productId
      initializedProductRef.current = true
    } else if (previousProductIdRef.current !== productId) {
      previousProductIdRef.current = productId
      setValue('defaultMediaId', undefined)
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
            if (!values.defaultMediaId && summary.defaultMediaId && !manualMediaSelections.current.has(productId)) {
              setValue('defaultMediaId', summary.defaultMediaId)
            }
          }
        }
        let attachments = attachmentCache.current.get(productId)
        if (!attachments) {
          attachments = await loadProductMedia(productId)
          attachmentCache.current.set(productId, attachments)
        }
        if (!cancelled && attachments) {
          setMediaOptions(attachments)
        }
        let variants = variantCache.current.get(productId)
        if (!variants) {
          const variantPayload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
            `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=${MAX_LIST_PAGE_SIZE}`,
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
    manualMediaSelections,
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
    setCurrentProductId,
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

async function loadProductMedia(productId: string): Promise<MediaOption[]> {
  if (!productId) return []
  const normalize = (items: Array<{ id?: string; fileName?: string; thumbnailUrl?: string | null }>) => (
    items
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
  )
  try {
    const primary = await apiCall<AttachmentsResponse>(
      `/api/catalog/product-media?productId=${encodeURIComponent(productId)}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (primary.ok && primary.result?.items) {
      return normalize(primary.result.items)
    }
  } catch (err) {
    console.error('catalog.product-media.lookup', err)
  }
  try {
    const fallback = await apiCall<AttachmentsResponse>(
      `/api/attachments?entityId=${encodeURIComponent(E.catalog.catalog_product)}&recordId=${encodeURIComponent(productId)}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (fallback.ok && fallback.result?.items) {
      return normalize(fallback.result.items)
    }
  } catch (err) {
    console.error('attachments.lookup', err)
  }
  return []
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

function mapProductSearchResult(item: Record<string, unknown>): ProductSearchResult {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    title: typeof item.title === 'string' ? item.title : '',
    sku: typeof item.sku === 'string' ? item.sku : null,
    defaultMediaUrl: typeof item.defaultMediaUrl === 'string'
      ? item.defaultMediaUrl
      : typeof item.default_media_url === 'string'
        ? item.default_media_url
      : null,
    pricing: item.pricing && typeof item.pricing === 'object'
      ? normalizePricing(item.pricing as Record<string, unknown>)
      : null,
  }
}

function formatPriceDisplay(pricing: PricingSummary | null): string {
  if (!pricing) return '—'
  const amount = pricing.displayMode === 'including-tax'
    ? pricing.unitPriceGross ?? pricing.unitPriceNet
    : pricing.unitPriceNet ?? pricing.unitPriceGross
  if (!amount) return pricing.currencyCode ?? '—'
  return `${pricing.currencyCode ?? ''} ${amount}`
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
    <div className="space-y-4">
      <div className="rounded border bg-muted/60 px-3 py-2">
        <div className="text-xs uppercase text-muted-foreground">
          {t('sales.channels.offers.pricing.basePriceLabel', 'Channel price')}
        </div>
        <div className="text-base font-semibold">
          {basePrice ? formatPriceDisplay(basePrice) : t('sales.channels.offers.pricing.basePriceMissing', 'No price found')}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('sales.channels.offers.pricing.basePriceHelp', 'Shown to shoppers when no override is configured.')}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t('sales.channels.offers.pricing.help', 'Provide overrides for price kinds when this offer is active.')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            {t('sales.channels.offers.pricing.add', 'Add price')}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('sales.channels.offers.pricing.overrideHint', 'Overrides take precedence over the channel price.')}
        </p>
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
              <div className="relative">
                {(row.currencyCode ?? basePrice?.currencyCode) ? (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                    {row.currencyCode ?? basePrice?.currencyCode}
                  </span>
                ) : null}
                <input
                  className={cn(
                    'w-full rounded border py-2 text-sm',
                    row.currencyCode || basePrice?.currencyCode ? 'pl-16 pr-2' : 'px-2',
                  )}
                  type="number"
                  placeholder={t('sales.channels.offers.pricing.amount', 'Amount')}
                  value={row.amount ?? ''}
                  onChange={(event) => updateRow(row.tempId, { amount: event.target.value })}
                />
              </div>
              <div className="flex flex-col justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
                <span>
                  {row.displayMode === 'including-tax'
                    ? t('sales.channels.offers.pricing.includingTax', 'Including tax')
                    : t('sales.channels.offers.pricing.excludingTax', 'Excluding tax')}
                </span>
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

function ProductOverviewCard({ summary, variants }: { summary: ProductSummary; variants: ProductVariantPreview[] }) {
  const t = useT()
  if (!summary) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('sales.channels.offers.form.productSummaryPlaceholder', 'Select a product to preview its media, price, and variants.')}
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="h-16 w-16 overflow-hidden rounded border bg-muted">
          {summary.defaultMediaUrl ? (
            <img src={summary.defaultMediaUrl} alt={summary.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{summary.title || t('sales.channels.offers.form.productUntitled', 'Untitled product')}</div>
          {summary.sku ? (
            <div className="text-xs text-muted-foreground">SKU · {summary.sku}</div>
          ) : null}
          <div className="text-sm">
            <span className="text-muted-foreground">{t('sales.channels.offers.form.productPriceLabel', 'Base price')}:</span>{' '}
            <span className="font-semibold">{formatPriceDisplay(summary.pricing)}</span>
          </div>
        </div>
      </div>
      {summary.description ? (
        <p className="text-sm text-muted-foreground">{summary.description}</p>
      ) : null}
      <ProductVariantsList variants={variants} />
    </div>
  )
}

function ProductVariantsList({ variants }: { variants: ProductVariantPreview[] }) {
  const t = useT()
  if (!variants.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('sales.channels.offers.form.variantsEmpty', 'No variants available for this product.')}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t('sales.channels.offers.form.variantsTitle', 'Variants')}</div>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {variants.map((variant) => (
          <div key={variant.id} className="flex gap-3 rounded border bg-card p-2">
            <div className="h-10 w-10 overflow-hidden rounded border bg-muted">
              {variant.thumbnailUrl ? (
                <img src={variant.thumbnailUrl} alt={variant.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium">{variant.name}</div>
              {variant.sku ? (
                <div className="text-[11px] text-muted-foreground">SKU · {variant.sku}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
