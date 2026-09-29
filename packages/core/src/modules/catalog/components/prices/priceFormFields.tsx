"use client"

import * as React from 'react'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  PriceChannelSelect,
  PriceCurrencySelect,
  PriceCustomerSelect,
  PricePriceKindSelect,
  PriceProductSelect,
  PriceVariantSelect,
} from './PriceScopeSelectors'

export type PriceFormValues = {
  id?: string
  productId?: string
  variantId?: string
  priceKindId?: string
  currencyCode?: string
  unitPriceNet?: string
  unitPriceGross?: string
  taxRate?: string
  minQuantity?: number
  maxQuantity?: number
  startsAt?: string
  endsAt?: string
  customerId?: string
  customerGroupId?: string
  channelId?: string
  offerId?: string
  userId?: string
  userGroupId?: string
  updatedAt?: string | null
}

export const PRICE_FORM_INITIAL_VALUES: PriceFormValues = {
  productId: '',
  variantId: '',
  priceKindId: '',
  currencyCode: '',
  unitPriceNet: '',
  unitPriceGross: '',
  taxRate: '',
  minQuantity: 1,
  maxQuantity: undefined,
  startsAt: '',
  endsAt: '',
  customerId: '',
  customerGroupId: '',
  channelId: '',
  offerId: '',
  userId: '',
  userGroupId: '',
}

/** Shared field/group config for the price-rule create and edit CrudForms. */
export function usePriceFormFields(): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'productId',
      label: t('catalog.prices.form.field.product', 'Product'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <PriceProductSelect value={typeof value === 'string' ? value : ''} onChange={setValue} />
      ),
    },
    {
      id: 'variantId',
      label: t('catalog.prices.form.field.variant', 'Variant'),
      type: 'custom',
      component: ({ value, setValue, values }) => (
        <PriceVariantSelect
          productId={typeof values?.productId === 'string' ? values.productId : ''}
          value={typeof value === 'string' ? value : ''}
          onChange={setValue}
        />
      ),
    },
    {
      id: 'priceKindId',
      label: t('catalog.prices.form.field.priceKind', 'Price kind'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => (
        <PricePriceKindSelect value={typeof value === 'string' ? value : ''} onChange={setValue} />
      ),
    },
    {
      id: 'currencyCode',
      label: t('catalog.prices.form.field.currency', 'Currency'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => (
        <PriceCurrencySelect value={typeof value === 'string' ? value : ''} onChange={setValue} />
      ),
    },
    {
      id: 'unitPriceNet',
      label: t('catalog.prices.form.field.unitPriceNet', 'Unit price (net)'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'unitPriceGross',
      label: t('catalog.prices.form.field.unitPriceGross', 'Unit price (gross)'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'taxRate',
      label: t('catalog.prices.form.field.taxRate', 'Tax rate'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'minQuantity',
      label: t('catalog.prices.form.field.minQuantity', 'Minimum quantity'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'maxQuantity',
      label: t('catalog.prices.form.field.maxQuantity', 'Maximum quantity'),
      type: 'number',
      layout: 'half',
      description: t('catalog.prices.form.field.maxQuantityHint', 'Leave empty for "and above"'),
    },
    {
      id: 'startsAt',
      label: t('catalog.prices.form.field.startsAt', 'Starts at'),
      type: 'datepicker',
      layout: 'half',
    },
    {
      id: 'endsAt',
      label: t('catalog.prices.form.field.endsAt', 'Ends at'),
      type: 'datepicker',
      layout: 'half',
    },
    {
      id: 'customerId',
      label: t('catalog.prices.form.field.customer', 'Customer'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <PriceCustomerSelect value={typeof value === 'string' ? value : ''} onChange={setValue} />
      ),
    },
    {
      id: 'customerGroupId',
      label: t('catalog.prices.form.field.customerGroupId', 'Customer group ID'),
      type: 'text',
      description: t(
        'catalog.prices.form.field.customerGroupIdHint',
        'Raw customer-group identifier — no customer-group directory yet.',
      ),
    },
    {
      id: 'channelId',
      label: t('catalog.prices.form.field.channel', 'Channel'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <PriceChannelSelect value={typeof value === 'string' ? value : ''} onChange={setValue} />
      ),
    },
    {
      id: 'offerId',
      label: t('catalog.prices.form.field.offer', 'Offer'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'userId',
      label: t('catalog.prices.form.field.userId', 'User ID'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'userGroupId',
      label: t('catalog.prices.form.field.userGroupId', 'User group ID'),
      type: 'text',
      layout: 'half',
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'product',
      title: t('catalog.prices.form.group.product', 'Product'),
      column: 1,
      fields: ['productId', 'variantId'],
    },
    {
      id: 'pricing',
      title: t('catalog.prices.form.group.pricing', 'Pricing'),
      column: 1,
      fields: ['priceKindId', 'currencyCode', 'unitPriceNet', 'unitPriceGross', 'taxRate'],
    },
    {
      id: 'quantity',
      title: t('catalog.prices.form.group.quantity', 'Quantity tier'),
      column: 1,
      fields: ['minQuantity', 'maxQuantity'],
    },
    {
      id: 'validity',
      title: t('catalog.prices.form.group.validity', 'Validity window'),
      column: 1,
      fields: ['startsAt', 'endsAt'],
    },
    {
      id: 'scope',
      title: t('catalog.prices.form.group.scope', 'Scope'),
      column: 2,
      fields: ['customerId', 'customerGroupId', 'channelId'],
    },
    {
      id: 'advanced',
      title: t('catalog.prices.form.group.advanced', 'Advanced scope'),
      column: 2,
      fields: ['offerId', 'userId', 'userGroupId'],
    },
  ], [t])

  return { fields, groups }
}
