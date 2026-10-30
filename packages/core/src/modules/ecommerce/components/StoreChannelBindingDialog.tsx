'use client'

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { ChannelBindingLiveCount, PriceSortFallbackConsequence } from './ChannelBindingFormSections'
import { ChannelLookupMultiPicker, ChannelLookupSinglePicker } from './ChannelLookupPicker'
import {
  categoryLookupSource,
  priceKindLookupSource,
  productLookupSource,
  salesChannelLookupSource,
  tagLookupSource,
  type LookupSource,
} from './channelLookups'
import {
  CHANNEL_BINDINGS_API_PATH,
  PRICE_SORT_CAP,
  PRICE_SORT_FALLBACKS,
  PRICE_SORT_FALLBACK_LABELS,
  buildChannelBindingCreatePayload,
  buildChannelBindingInitialValues,
  buildChannelBindingUpdatePayload,
  channelBindingFormSchema,
  type ChannelBindingFormValues,
  type ChannelBindingRecord,
  type ScopeIdField,
} from './storeChannels'

type StoreChannelBindingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
  binding: ChannelBindingRecord | null
  firstBinding: boolean
  readOnly: boolean
  onSaved: () => void | Promise<void>
}

function toIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function scopePickerField(
  id: ScopeIdField,
  label: string,
  placeholder: string,
  source: LookupSource,
  readOnly: boolean,
): CrudField {
  return {
    id,
    type: 'custom',
    label,
    disabled: readOnly,
    component: ({ value, setValue, disabled }) => (
      <ChannelLookupMultiPicker
        source={source}
        value={toIdList(value)}
        onChange={(next) => setValue(next)}
        placeholder={placeholder}
        disabled={disabled || readOnly}
      />
    ),
  }
}

export function StoreChannelBindingDialog({
  open,
  onOpenChange,
  storeId,
  binding,
  firstBinding,
  readOnly,
  onSaved,
}: StoreChannelBindingDialogProps) {
  const t = useT()
  const locale = useLocale()
  const cap = React.useMemo(() => new Intl.NumberFormat(locale).format(PRICE_SORT_CAP), [locale])
  const isCurrentDefault = binding?.isDefault === true

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'salesChannelId',
        type: 'custom',
        label: t('ecommerce.backend.store.channels.form.salesChannel', 'Sales channel'),
        required: true,
        disabled: readOnly,
        component: ({ value, setValue, disabled }) => (
          <ChannelLookupSinglePicker
            source={salesChannelLookupSource}
            value={typeof value === 'string' ? value : ''}
            onChange={(next) => setValue(next)}
            placeholder={t('ecommerce.backend.store.channels.form.salesChannelPlaceholder', 'Select a sales channel…')}
            disabled={disabled || readOnly}
          />
        ),
      },
      {
        id: 'priceKindId',
        type: 'custom',
        label: t('ecommerce.backend.store.channels.form.priceKind', 'Price kind override'),
        description: t(
          'ecommerce.backend.store.channels.form.priceKindHint',
          'Optional. The price kind anonymous visitors see on this channel. Leave empty to use the default price kind.',
        ),
        disabled: readOnly,
        component: ({ value, setValue, disabled }) => (
          <ChannelLookupSinglePicker
            source={priceKindLookupSource}
            value={typeof value === 'string' ? value : ''}
            onChange={(next) => setValue(next)}
            placeholder={t('ecommerce.backend.store.channels.form.priceKindPlaceholder', 'Default price kind')}
            disabled={disabled || readOnly}
            clearable
          />
        ),
      },
      {
        id: 'isDefault',
        type: 'checkbox',
        label: t('ecommerce.backend.store.channels.form.isDefault', 'Default channel of this store'),
        description: isCurrentDefault
          ? t(
              'ecommerce.backend.store.channels.form.isDefaultLocked',
              'This is the default binding. To change it, make another binding the default; a store without a default channel cannot serve its storefront.',
            )
          : t(
              'ecommerce.backend.store.channels.form.isDefaultHint',
              'The storefront serves the default binding. Making this binding the default removes the mark from the current default.',
            ),
        disabled: readOnly || isCurrentDefault,
      },
      scopePickerField(
        'categoryIds',
        t('ecommerce.backend.store.channels.form.categoryIds', 'Categories'),
        t('ecommerce.backend.store.channels.form.categoryPlaceholder', 'Search categories'),
        categoryLookupSource,
        readOnly,
      ),
      scopePickerField(
        'tagIds',
        t('ecommerce.backend.store.channels.form.tagIds', 'Tags'),
        t('ecommerce.backend.store.channels.form.tagPlaceholder', 'Search tags'),
        tagLookupSource,
        readOnly,
      ),
      scopePickerField(
        'excludeProductIds',
        t('ecommerce.backend.store.channels.form.excludeProductIds', 'Products'),
        t('ecommerce.backend.store.channels.form.productPlaceholder', 'Search products'),
        productLookupSource,
        readOnly,
      ),
      scopePickerField(
        'excludeCategoryIds',
        t('ecommerce.backend.store.channels.form.excludeCategoryIds', 'Categories'),
        t('ecommerce.backend.store.channels.form.categoryPlaceholder', 'Search categories'),
        categoryLookupSource,
        readOnly,
      ),
      scopePickerField(
        'excludeTagIds',
        t('ecommerce.backend.store.channels.form.excludeTagIds', 'Tags'),
        t('ecommerce.backend.store.channels.form.tagPlaceholder', 'Search tags'),
        tagLookupSource,
        readOnly,
      ),
      {
        id: 'requireAuthentication',
        type: 'checkbox',
        label: t('ecommerce.backend.store.channels.form.requireAuthentication', 'Require sign-in to see products'),
        description: t(
          'ecommerce.backend.store.channels.form.requireAuthenticationHint',
          'Anonymous visitors see no products on this channel; signed-in buyers see their usual assortment. This governs catalog visibility only, not the whole storefront: pages and sign-in stay reachable. Takes effect on save.',
        ),
        disabled: readOnly,
      },
      {
        id: 'priceSortFallback',
        type: 'select',
        label: t('ecommerce.backend.store.channels.form.priceSortFallback', 'Price sorting past {cap} products', { cap }),
        description: t(
          'ecommerce.backend.store.channels.form.priceSortFallbackHint',
          'The storefront sorts by price for at most {cap} matching products. Choose what happens on this channel when more products match.',
          { cap },
        ),
        options: PRICE_SORT_FALLBACKS.map((value) => ({
          value,
          label: t(PRICE_SORT_FALLBACK_LABELS[value].key, PRICE_SORT_FALLBACK_LABELS[value].fallback),
        })),
        required: true,
        disabled: readOnly,
      },
    ],
    [cap, isCurrentDefault, readOnly, t],
  )

  const bindingId = binding?.id ?? null

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      { id: 'binding', fields: ['salesChannelId', 'priceKindId', 'isDefault'] },
      {
        id: 'scopeInclude',
        title: t('ecommerce.backend.store.channels.form.includeTitle', 'Show only products in'),
        description: t(
          'ecommerce.backend.store.channels.form.includeHint',
          "A product shows when it is in any of the chosen categories and carries any of the chosen tags. An empty picker does not filter, so leave both empty to show the channel's whole catalog; clearing a picker never hides everything.",
        ),
        fields: ['categoryIds', 'tagIds'],
      },
      {
        id: 'scopeExclude',
        title: t('ecommerce.backend.store.channels.form.excludeTitle', 'Always hide'),
        description: t(
          'ecommerce.backend.store.channels.form.excludeHint',
          'Hidden products, categories and tags win over the selection above.',
        ),
        fields: ['excludeProductIds', 'excludeCategoryIds', 'excludeTagIds'],
      },
      {
        id: 'policies',
        title: t('ecommerce.backend.store.channels.form.policiesTitle', 'Catalogue policies'),
        fields: ['requireAuthentication', 'priceSortFallback'],
      },
      {
        id: 'priceSortConsequence',
        bare: true,
        component: ({ values }) => <PriceSortFallbackConsequence values={values} />,
      },
      {
        id: 'liveCount',
        bare: true,
        component: ({ values }) => <ChannelBindingLiveCount bindingId={bindingId} values={values} />,
      },
    ],
    [bindingId, t],
  )

  const initialValues = React.useMemo(
    () => buildChannelBindingInitialValues(binding, { firstBinding }),
    [binding, firstBinding],
  )

  const handleSubmit = React.useCallback(
    async (values: ChannelBindingFormValues) => {
      if (binding) {
        await updateCrud(CHANNEL_BINDINGS_API_PATH, buildChannelBindingUpdatePayload(binding.id, values), {
          errorMessage: t('ecommerce.backend.store.channels.errors.update', 'Failed to update the channel binding.'),
        })
        flash(t('ecommerce.backend.store.channels.flash.updated', 'Channel binding updated'), 'success')
      } else {
        await createCrud(CHANNEL_BINDINGS_API_PATH, buildChannelBindingCreatePayload(storeId, values), {
          errorMessage: t('ecommerce.backend.store.channels.errors.create', 'Failed to add the channel binding.'),
        })
        flash(t('ecommerce.backend.store.channels.flash.created', 'Channel binding added'), 'success')
      }
      onOpenChange(false)
      await onSaved()
    },
    [binding, onOpenChange, onSaved, storeId, t],
  )

  const title = readOnly
    ? t('ecommerce.backend.store.channels.view.title', 'Channel binding')
    : binding
      ? t('ecommerce.backend.store.channels.edit.title', 'Edit channel binding')
      : t('ecommerce.backend.store.channels.add.title', 'Add channel binding')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t(
              'ecommerce.backend.store.channels.dialog.description',
              'Bind a sales channel to this store and decide what it shows and to whom: the assortment scope, the sign-in requirement and how price sorting behaves on a large catalogue.',
            )}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<ChannelBindingFormValues>
          key={`${binding?.id ?? 'new'}:${binding?.updatedAt ?? ''}`}
          schema={channelBindingFormSchema}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          optimisticLockUpdatedAt={binding?.updatedAt ?? null}
          readOnly={readOnly}
          submitLabel={
            binding
              ? t('ecommerce.backend.store.channels.edit.submit', 'Save binding')
              : t('ecommerce.backend.store.channels.add.submit', 'Add binding')
          }
          onSubmit={handleSubmit}
          embedded
        />
      </DialogContent>
    </Dialog>
  )
}
