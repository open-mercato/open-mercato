"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { Input } from '@open-mercato/ui/primitives/input'
import { AMOUNT_CURRENCIES } from '@open-mercato/ui/primitives/amount-input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogMediaManager,
  type CatalogMediaItem,
} from '@open-mercato/core/modules/catalog/components/products/ProductMediaManager'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { DictionaryEntrySelect, type DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from '@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary'
import { CategorySelect } from '../categories/CategorySelect'
import { ServiceWorkRequirements, type ServiceWorkRequirementDraft } from './ServiceWorkRequirements'

export type ServiceFormValues = {
  id?: string
  title: string
  description?: string | null
  scope?: string | null
  categoryId?: string | null
  defaultPriceAmount?: string | number | null
  defaultPriceCurrencyCode?: string | null
  defaultMediaId?: string | null
  defaultMediaUrl?: string | null
  mediaDraftId: string
  mediaItems: CatalogMediaItem[]
  workRequirements: ServiceWorkRequirementDraft[]
  isActive?: boolean
  updatedAt?: string | null
} & Record<string, unknown>

type Props = {
  title: string
  submitLabel: string
  initialValues: ServiceFormValues
  onSubmit: (values: ServiceFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
  optimisticLockUpdatedAt?: string | null
  successRedirect?: string
  deleteRedirect?: string
}

export function createServiceInitialValues(overrides: Partial<ServiceFormValues> = {}): ServiceFormValues {
  return {
    title: '',
    description: '',
    scope: '',
    categoryId: '',
    defaultPriceAmount: '',
    defaultPriceCurrencyCode: '',
    defaultMediaId: null,
    defaultMediaUrl: '',
    mediaDraftId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `service-media-${Date.now()}`,
    mediaItems: [],
    workRequirements: [],
    isActive: true,
    ...overrides,
  }
}

function trimOptional(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function toPriceAmount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim().length) return value.trim()
  return null
}

export function normalizeServiceDefaultPriceAmount(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!match) return raw
  const [, integerPart, fractionPart = ''] = match
  if (!fractionPart) return integerPart
  if (fractionPart.length <= 2) return raw
  const visibleFraction = fractionPart.slice(0, 2).padEnd(2, '0')
  const storageFraction = fractionPart.slice(2)
  return /^0+$/.test(storageFraction) ? `${integerPart}.${visibleFraction}` : raw
}

function mediaUrl(item: CatalogMediaItem): string {
  return item.url || buildAttachmentImageUrl(item.id, { slug: slugifyAttachmentFileName(item.fileName) })
}

export function normalizeServiceMediaItem(input: Record<string, unknown>): CatalogMediaItem | null {
  const id = trimOptional(input.fileId) ?? trimOptional(input.id)
  if (!id) return null
  const label = trimOptional(input.alt) ?? trimOptional(input.fileName) ?? id
  const url = trimOptional(input.url) ?? buildAttachmentImageUrl(id, { slug: slugifyAttachmentFileName(label) })
  return {
    id,
    url,
    fileName: label,
    fileSize: typeof input.fileSize === 'number' ? input.fileSize : undefined,
    thumbnailUrl: url,
  }
}

export function buildServicePayload(values: ServiceFormValues, t: ReturnType<typeof useT>): Record<string, unknown> {
  const title = trimOptional(values.title)
  if (!title) {
    const message = t('catalog.services.form.errors.title', 'Provide the service title.')
    throw createCrudFormError(message, { title: message })
  }
  const currency = trimOptional(values.defaultPriceCurrencyCode)
  const price = toPriceAmount(values.defaultPriceAmount)
  if (price && !currency) {
    const message = t('catalog.services.form.errors.priceCurrency', 'Provide both default price and currency, or leave both empty.')
    throw createCrudFormError(message, { defaultPriceAmount: message, defaultPriceCurrencyCode: message })
  }

  const mediaItems = Array.isArray(values.mediaItems) ? values.mediaItems : []
  const defaultMediaId = trimOptional(values.defaultMediaId)
  const defaultMediaEntry = defaultMediaId ? mediaItems.find((item) => item.id === defaultMediaId) : null
  const customFields = collectCustomFieldValues(values)
  const workRequirements = Array.isArray(values.workRequirements) ? values.workRequirements.map((item, index) => {
    const labelSnapshot = trimOptional(item.labelSnapshot) ?? ''
    const allocationValue = Number(item.allocationValue)
    if (!labelSnapshot) {
      const message = t('catalog.services.form.errors.workRequirementLabel', 'Provide a label for every work requirement.')
      throw createCrudFormError(message, { workRequirements: message })
    }
    if (!Number.isFinite(allocationValue) || allocationValue <= 0) {
      const message = t('catalog.services.form.errors.workRequirementValue', 'Provide a positive value for every work requirement.')
      throw createCrudFormError(message, { workRequirements: message })
    }
    return {
      targetType: item.targetType,
      targetId: trimOptional(item.targetId),
      labelSnapshot,
      allocationMode: item.allocationMode,
      allocationValue,
      sortOrder: index,
      metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    }
  }) : []

  return {
    ...(trimOptional(values.id) ? { id: trimOptional(values.id) } : {}),
    title,
    description: trimOptional(values.description),
    scope: trimOptional(values.scope),
    categoryId: trimOptional(values.categoryId),
    defaultPriceAmount: price,
    defaultPriceCurrencyCode: price ? currency : null,
    defaultMediaId,
    defaultMediaUrl: defaultMediaEntry ? mediaUrl(defaultMediaEntry) : trimOptional(values.defaultMediaUrl),
    media: mediaItems.map((item, index) => ({
      fileId: item.id,
      url: mediaUrl(item),
      alt: item.fileName,
      sortOrder: index,
      isDefault: item.id === defaultMediaId,
      metadata: {},
    })),
    workRequirements,
    isActive: values.isActive !== false,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

function ServiceMediaField({
  id,
  values,
  setValue,
  setFormValue,
}: {
  id: string
  values?: Record<string, unknown>
  setValue: (value: unknown) => void
  setFormValue?: (id: string, value: unknown) => void
}) {
  const mediaItems = Array.isArray(values?.mediaItems) ? values.mediaItems as CatalogMediaItem[] : []
  const defaultMediaId = trimOptional(values?.defaultMediaId)
  const draftRecordId = trimOptional(values?.mediaDraftId) ?? trimOptional(values?.id) ?? id

  const updateMediaItems = React.useCallback((nextItems: CatalogMediaItem[]) => {
    setValue(nextItems)
  }, [setValue])

  return (
    <CatalogMediaManager
      entityId={E.catalog.catalog_service}
      draftRecordId={draftRecordId}
      items={mediaItems}
      defaultMediaId={defaultMediaId}
      onItemsChange={updateMediaItems}
      onDefaultChange={(attachmentId) => {
        const target = mediaItems.find((item) => item.id === attachmentId)
        setFormValue?.('defaultMediaId', attachmentId)
        setFormValue?.('defaultMediaUrl', target ? mediaUrl(target) : '')
      }}
      translationPrefix="catalog.services.media"
      showLabel={false}
    />
  )
}

const FALLBACK_CURRENCY_OPTIONS: DictionaryOption[] = AMOUNT_CURRENCIES.map((currency) => ({
  value: currency.code,
  label: `${currency.code} — ${currency.label}`,
  color: null,
  icon: currency.flag ?? null,
}))

function DefaultServicePriceField({
  id,
  initialCurrencyCode,
  value,
  values,
  setValue,
  setFormValue,
}: {
  id: string
  initialCurrencyCode?: string | null
  value: unknown
  values?: Record<string, unknown>
  setValue: (value: unknown) => void
  setFormValue?: (id: string, value: unknown) => void
}) {
  const t = useT()
  const { data: currencyDictionary, refetch: refetchCurrencyDictionary } = useCurrencyDictionary()
  const selectedCurrency = trimOptional(values?.defaultPriceCurrencyCode) ?? trimOptional(initialCurrencyCode) ?? ''

  const currencyOptionsLoader = React.useCallback(async (): Promise<DictionaryOption[]> => {
    const ensureSelectedOption = (options: DictionaryOption[]) => {
      if (!selectedCurrency || options.some((option) => option.value === selectedCurrency)) return options
      return [
        ...options,
        {
          value: selectedCurrency,
          label: selectedCurrency,
          color: null,
          icon: null,
        },
      ]
    }
    const mapEntries = (entries: Array<{ value: string; label: string; color?: string | null; icon?: string | null }>) =>
      entries.map((entry) => ({
        value: entry.value,
        label: entry.label && entry.label !== entry.value ? `${entry.value} — ${entry.label}` : entry.value,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      }))
    try {
      if (currencyDictionary?.entries?.length) return ensureSelectedOption(mapEntries(currencyDictionary.entries))
      const payload = await refetchCurrencyDictionary()
      return ensureSelectedOption(payload.entries.length ? mapEntries(payload.entries) : FALLBACK_CURRENCY_OPTIONS)
    } catch {
      return ensureSelectedOption(FALLBACK_CURRENCY_OPTIONS)
    }
  }, [currencyDictionary, refetchCurrencyDictionary, selectedCurrency])

  const currencyLabels = React.useMemo(() => ({
    placeholder: t('catalog.services.form.field.currencyPlaceholder', 'Select currency…'),
    addLabel: t('catalog.services.form.field.currencyAdd', 'Add currency'),
    dialogTitle: t('catalog.services.form.field.currencyDialogTitle', 'Add currency'),
    valueLabel: t('catalog.services.form.field.currencyValueLabel', 'Currency code'),
    valuePlaceholder: t('catalog.services.form.field.currencyValuePlaceholder', 'e.g. USD'),
    labelLabel: t('catalog.services.form.field.currencyLabelLabel', 'Display label'),
    labelPlaceholder: t('catalog.services.form.field.currencyLabelPlaceholder', 'e.g. US Dollar'),
    emptyError: t('catalog.services.form.field.currencyEmptyError', 'Please provide a currency code.'),
    cancelLabel: t('ui.forms.actions.cancel', 'Cancel'),
    saveLabel: t('ui.forms.actions.save', 'Save'),
    errorLoad: t('catalog.services.form.field.currencyLoadError', 'Unable to load currencies.'),
    errorSave: t('catalog.services.form.field.currencySaveError', 'Unable to save currency.'),
    loadingLabel: t('catalog.services.form.field.currencyLoading', 'Loading currencies…'),
    manageTitle: t('catalog.services.form.field.currencyManage', 'Manage currencies'),
  }), [t])
  const amountValue = typeof value === 'string' ? value : normalizeServiceDefaultPriceAmount(value)

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs font-medium text-muted-foreground">
        <span>{t('catalog.services.form.field.defaultPriceAmount', 'Default price')}</span>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          className="h-9 tabular-nums"
          value={amountValue}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('catalog.services.form.field.defaultPricePlaceholder', '0.00')}
        />
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">
        <span>{t('catalog.services.form.field.defaultPriceCurrencyCode', 'Currency')}</span>
        <DictionaryEntrySelect
          id={`${id}-currency`}
          value={selectedCurrency}
          onChange={(next) => setFormValue?.('defaultPriceCurrencyCode', next ?? '')}
          fetchOptions={currencyOptionsLoader}
          labels={currencyLabels}
          allowInlineCreate={false}
          showManage={false}
          showActiveAppearance={false}
          selectClassName="h-9 w-full"
        />
      </label>
    </div>
  )
}

export function ServiceForm({
  title,
  submitLabel,
  initialValues,
  onSubmit,
  onDelete,
  isLoading,
  loadingMessage,
  optimisticLockUpdatedAt,
  successRedirect,
  deleteRedirect,
}: Props) {
  const t = useT()
  const normalizedInitialValues = React.useMemo<ServiceFormValues>(() => ({
    ...initialValues,
    defaultPriceAmount: normalizeServiceDefaultPriceAmount(initialValues.defaultPriceAmount),
  }), [initialValues])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: t('catalog.services.form.field.title', 'Title'),
      type: 'text',
      required: true,
      placeholder: t('catalog.services.form.field.titlePlaceholder', 'e.g., Implementation workshop'),
    },
    {
      id: 'description',
      label: t('catalog.services.form.field.description', 'Description'),
      type: 'textarea',
      rows: 5,
    },
    {
      id: 'scope',
      label: t('catalog.services.form.field.scope', 'Scope'),
      type: 'textarea',
      rows: 4,
    },
    {
      id: 'categoryId',
      label: t('catalog.services.form.field.category', 'Category'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <CategorySelect
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(next ?? '')}
          includeEmptyOption
          emptyOptionLabel={t('catalog.services.form.field.categoryEmpty', 'No category')}
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    {
      id: 'defaultPriceAmount',
      label: '',
      type: 'custom',
      component: ({ id, value, values, setValue, setFormValue }) => (
        <DefaultServicePriceField
          id={id}
          initialCurrencyCode={normalizedInitialValues.defaultPriceCurrencyCode}
          value={value}
          values={values}
          setValue={setValue}
          setFormValue={setFormValue}
        />
      ),
    },
    {
      id: 'defaultPriceCurrencyCode',
      label: '',
      type: 'custom',
      component: () => null,
    },
    {
      id: 'mediaItems',
      label: '',
      type: 'custom',
      component: ({ id, values, setValue, setFormValue }) => (
        <ServiceMediaField id={id} values={values} setValue={setValue} setFormValue={setFormValue} />
      ),
    },
    {
      id: 'workRequirements',
      label: '',
      type: 'custom',
      component: ({ value, setValue }) => (
        <ServiceWorkRequirements
          value={Array.isArray(value) ? value as ServiceWorkRequirementDraft[] : []}
          onChange={setValue}
          showHeader={false}
        />
      ),
    },
    {
      id: 'isActive',
      label: t('catalog.services.form.field.isActive', 'Active'),
      type: 'checkbox',
    },
  ], [normalizedInitialValues.defaultPriceCurrencyCode, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('catalog.services.form.group.details', 'Details'),
      column: 1,
      fields: ['title', 'description', 'scope', 'categoryId', 'isActive'],
    },
    {
      id: 'work',
      title: t('catalog.services.form.group.work', 'Work requirements'),
      column: 1,
      fields: ['workRequirements'],
    },
    {
      id: 'pricing',
      title: t('catalog.services.form.group.pricing', 'Default pricing'),
      column: 2,
      fields: ['defaultPriceAmount'],
    },
    {
      id: 'media',
      title: t('catalog.services.form.group.media', 'Media'),
      column: 2,
      fields: ['mediaItems'],
    },
    {
      id: 'custom',
      title: t('catalog.services.form.group.custom', 'Custom data'),
      column: 2,
      kind: 'customFields',
    },
  ], [t])

  return (
    <CrudForm<ServiceFormValues>
      title={title}
      backHref="/backend/catalog/services"
      fields={fields}
      groups={groups}
      entityId={E.catalog.catalog_service}
      initialValues={normalizedInitialValues}
      optimisticLockUpdatedAt={optimisticLockUpdatedAt ?? initialValues.updatedAt ?? null}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
      submitLabel={submitLabel}
      cancelHref="/backend/catalog/services"
      successRedirect={successRedirect}
      onSubmit={onSubmit}
      onDelete={onDelete}
      deleteRedirect={deleteRedirect}
      versionHistory={normalizedInitialValues.id ? { resourceKind: 'catalog.service', resourceId: normalizedInitialValues.id } : undefined}
      injectionSpotId="crud-form:catalog.service"
    />
  )
}
