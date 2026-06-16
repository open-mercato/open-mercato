"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogMediaManager,
  type CatalogMediaItem,
} from '@open-mercato/core/modules/catalog/components/products/ProductMediaManager'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
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
    defaultPriceCurrencyCode: 'USD',
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
    fileSize: typeof input.fileSize === 'number' ? input.fileSize : 0,
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
  if ((price && !currency) || (!price && currency && currency !== 'USD')) {
    const message = t('catalog.services.form.errors.priceCurrency', 'Provide both default price and currency, or leave both empty.')
    throw createCrudFormError(message, { defaultPriceAmount: message, defaultPriceCurrencyCode: message })
  }

  const mediaItems = Array.isArray(values.mediaItems) ? values.mediaItems : []
  const defaultMediaId = trimOptional(values.defaultMediaId)
  const defaultMediaEntry = defaultMediaId ? mediaItems.find((item) => item.id === defaultMediaId) : null
  const customFields = collectCustomFieldValues(values)
  const workRequirements = Array.isArray(values.workRequirements)
    ? values.workRequirements
        .map((item, index) => ({
          targetType: item.targetType,
          targetId: trimOptional(item.targetId),
          labelSnapshot: trimOptional(item.labelSnapshot) ?? '',
          allocationMode: item.allocationMode,
          allocationValue: Number(item.allocationValue),
          sortOrder: index,
          metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
        }))
        .filter((item) => item.labelSnapshot.length > 0 && Number.isFinite(item.allocationValue) && item.allocationValue > 0)
    : []

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
    />
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
      label: t('catalog.services.form.field.defaultPriceAmount', 'Default price'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'defaultPriceCurrencyCode',
      label: t('catalog.services.form.field.defaultPriceCurrencyCode', 'Currency'),
      type: 'text',
      layout: 'half',
      placeholder: 'USD',
    },
    {
      id: 'mediaItems',
      label: t('catalog.services.media.label', 'Media'),
      type: 'custom',
      component: ({ id, values, setValue, setFormValue }) => (
        <ServiceMediaField id={id} values={values} setValue={setValue} setFormValue={setFormValue} />
      ),
    },
    {
      id: 'workRequirements',
      label: t('catalog.services.work.title', 'Work requirements'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <ServiceWorkRequirements
          value={Array.isArray(value) ? value as ServiceWorkRequirementDraft[] : []}
          onChange={setValue}
        />
      ),
    },
    {
      id: 'isActive',
      label: t('catalog.services.form.field.isActive', 'Active'),
      type: 'checkbox',
    },
  ], [t])

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
      fields: ['defaultPriceAmount', 'defaultPriceCurrencyCode'],
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
      initialValues={initialValues}
      optimisticLockUpdatedAt={optimisticLockUpdatedAt ?? initialValues.updatedAt ?? null}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
      submitLabel={submitLabel}
      cancelHref="/backend/catalog/services"
      successRedirect={successRedirect}
      onSubmit={onSubmit}
      onDelete={onDelete}
      deleteRedirect={deleteRedirect}
      versionHistory={initialValues.id ? { resourceKind: 'catalog.service', resourceId: initialValues.id } : undefined}
      injectionSpotId="crud-form:catalog.service"
    />
  )
}
