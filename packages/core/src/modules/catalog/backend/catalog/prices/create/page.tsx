"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { PRICE_FORM_INITIAL_VALUES, usePriceFormFields, type PriceFormValues } from '../../../../components/prices/priceFormFields'

function buildPricePayload(values: PriceFormValues, t: (key: string, fallback?: string) => string): Record<string, unknown> {
  const productId = values.productId?.trim() || undefined
  const variantId = values.variantId?.trim() || undefined
  if (!productId && !variantId) {
    const message = t('catalog.prices.form.errors.productOrVariantRequired', 'Choose a product or a variant.')
    throw createCrudFormError(message, { productId: message })
  }
  const priceKindId = values.priceKindId?.trim() || undefined
  const currencyCode = values.currencyCode?.trim() || undefined
  const payload: Record<string, unknown> = {
    productId,
    variantId,
    priceKindId,
    currencyCode,
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
  return payload
}

export default function CreateCatalogPricePage() {
  const t = useT()
  const { fields, groups } = usePriceFormFields()
  const successMessage = encodeURIComponent(t('catalog.prices.flash.created', 'Price rule created'))

  return (
    <Page>
      <PageBody>
        <CrudForm<PriceFormValues>
          title={t('catalog.prices.form.createTitle', 'Create price rule')}
          titleHeadingLevel={1}
          backHref="/backend/catalog/prices"
          fields={fields}
          groups={groups}
          collapsibleGroups
          entityId={E.catalog.catalog_product_price}
          initialValues={PRICE_FORM_INITIAL_VALUES}
          submitLabel={t('catalog.prices.form.action.save', 'Save')}
          cancelHref="/backend/catalog/prices"
          successRedirect={`/backend/catalog/prices?flash=${successMessage}&type=success`}
          onSubmit={async (values) => {
            const payload = buildPricePayload(values, t)
            await createCrud('catalog/prices', payload)
          }}
        />
      </PageBody>
    </Page>
  )
}
