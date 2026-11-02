"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { usePriceFormFields, type PriceFormValues } from '../../../../../components/prices/priceFormFields'
import { normalizePriceRecord } from '../../../../../components/prices/normalizePriceRecord'

type PriceListResponse = {
  items?: Array<Record<string, unknown>>
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function buildUpdatePayload(
  id: string,
  values: PriceFormValues,
  t: (key: string, fallback?: string) => string,
): Record<string, unknown> {
  const productId = values.productId?.trim() || undefined
  const variantId = values.variantId?.trim() || undefined
  if (!productId && !variantId) {
    const message = t('catalog.prices.form.errors.productOrVariantRequired', 'Choose a product or a variant.')
    throw createCrudFormError(message, { productId: message })
  }
  return {
    id,
    productId,
    variantId,
    priceKindId: values.priceKindId?.trim() || undefined,
    currencyCode: values.currencyCode?.trim() || undefined,
    unitPriceNet: values.unitPriceNet?.trim() || undefined,
    unitPriceGross: values.unitPriceGross?.trim() || undefined,
    taxRate: values.taxRate?.trim() || undefined,
    minQuantity: values.minQuantity ?? undefined,
    maxQuantity: values.maxQuantity ?? undefined,
    startsAt: values.startsAt?.trim() || undefined,
    endsAt: values.endsAt?.trim() || undefined,
    customerId: values.customerId?.trim() || undefined,
    customerGroupId: values.customerGroupId?.trim() || undefined,
    channelId: values.channelId?.trim() || undefined,
    offerId: values.offerId?.trim() || undefined,
    userId: values.userId?.trim() || undefined,
    userGroupId: values.userGroupId?.trim() || undefined,
  }
}

export default function EditCatalogPricePage({ params }: { params?: { id?: string } }) {
  const priceId = params?.id ?? ''
  const t = useT()
  const { fields, groups } = usePriceFormFields()
  const [initialValues, setInitialValues] = React.useState<PriceFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    if (!priceId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const { ok, status, result } = await apiCall<PriceListResponse>(
          `/api/catalog/prices?ids=${encodeURIComponent(priceId)}&pageSize=1`,
        )
        if (!ok) {
          if (status === 404) {
            if (!cancelled) setIsNotFound(true)
            return
          }
          throw new Error(t('catalog.prices.form.errors.load', 'Failed to load price rule'))
        }
        const raw = Array.isArray(result?.items) ? result.items[0] : null
        if (!raw) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (cancelled) return
        const record = normalizePriceRecord(raw)
        setInitialValues({
          id: record.id,
          productId: record.productId ?? '',
          variantId: record.variantId ?? '',
          priceKindId: record.priceKindId ?? '',
          currencyCode: record.currencyCode ?? '',
          unitPriceNet: record.unitPriceNet ?? '',
          unitPriceGross: record.unitPriceGross ?? '',
          taxRate: record.taxRate ?? '',
          minQuantity: record.minQuantity ?? 1,
          maxQuantity: record.maxQuantity ?? undefined,
          startsAt: toDateInputValue(record.startsAt),
          endsAt: toDateInputValue(record.endsAt),
          customerId: record.customerId ?? '',
          customerGroupId: record.customerGroupId ?? '',
          channelId: record.channelId ?? '',
          offerId: record.offerId ?? '',
          userId: record.userId ?? '',
          userGroupId: record.userGroupId ?? '',
          updatedAt: record.updatedAt ?? null,
        })
      } catch (err) {
        if (!cancelled) {
          const fallback = t('catalog.prices.form.errors.load', 'Failed to load price rule')
          const message = err instanceof Error ? err.message : fallback
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [priceId, t])

  if (!priceId) {
    return (
      <Page>
        <PageBody>
          <p className="text-sm text-destructive">
            {t('catalog.prices.form.errors.idRequired', 'Price rule identifier is required.')}
          </p>
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('catalog.prices.form.errors.notFound', 'Price rule not found')}
            backHref="/backend/catalog/prices"
            backLabel={t('catalog.prices.form.actions.backToList', 'Back to price rules')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !loading) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<PriceFormValues>
          title={t('catalog.prices.form.editTitle', 'Edit price rule')}
          titleHeadingLevel={1}
          backHref="/backend/catalog/prices"
          fields={fields}
          groups={groups}
          collapsibleGroups
          entityId={E.catalog.catalog_product_price}
          initialValues={initialValues ?? { id: priceId }}
          optimisticLockUpdatedAt={initialValues?.updatedAt}
          isLoading={loading}
          loadingMessage={t('catalog.prices.form.loading', 'Loading price rule...')}
          submitLabel={t('catalog.prices.form.action.save', 'Save')}
          cancelHref="/backend/catalog/prices"
          successRedirect={`/backend/catalog/prices?flash=${encodeURIComponent(t('catalog.prices.flash.updated', 'Price rule updated'))}&type=success`}
          onSubmit={async (values) => {
            const payload = buildUpdatePayload(priceId, values, t)
            await updateCrud('catalog/prices', payload)
          }}
          onDelete={async () => {
            await deleteCrud('catalog/prices', priceId, {
              errorMessage: t('catalog.prices.form.errors.delete', 'Failed to delete price rule'),
            })
          }}
          deleteRedirect={`/backend/catalog/prices?flash=${encodeURIComponent(t('catalog.prices.flash.deleted', 'Price rule deleted'))}&type=success`}
        />
      </PageBody>
    </Page>
  )
}
