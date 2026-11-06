"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import {
  buildServicePayload,
  createServiceInitialValues,
  normalizeServiceMediaItem,
  ServiceForm,
  type ServiceFormValues,
} from '../../../../../components/services/ServiceForm'
import type { ServiceWorkRequirementDraft } from '../../../../../components/services/ServiceWorkRequirements'
import {
  CATALOG_SERVICE_WORK_ALLOCATION_MODES,
  CATALOG_SERVICE_WORK_TARGET_TYPES,
  type CatalogServiceWorkAllocationMode,
  type CatalogServiceWorkTargetType,
} from '../../../../../data/types'

type ServiceResponse = {
  items?: Array<Record<string, unknown>>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function bool(value: unknown, fallback = true): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeWorkRequirement(input: Record<string, unknown>, index: number): ServiceWorkRequirementDraft | null {
  const targetType = text(input.targetType) ?? text(input.target_type)
  const allocationMode = text(input.allocationMode) ?? text(input.allocation_mode)
  const labelSnapshot = text(input.labelSnapshot) ?? text(input.label_snapshot)
  if (
    !targetType ||
    !allocationMode ||
    !labelSnapshot ||
    !CATALOG_SERVICE_WORK_TARGET_TYPES.includes(targetType as CatalogServiceWorkTargetType) ||
    !CATALOG_SERVICE_WORK_ALLOCATION_MODES.includes(allocationMode as CatalogServiceWorkAllocationMode)
  ) {
    return null
  }
  const rawValue = input.allocationValue ?? input.allocation_value
  const allocationValue = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  return {
    id: text(input.id) ?? undefined,
    targetType: targetType as CatalogServiceWorkTargetType,
    targetId: text(input.targetId) ?? text(input.target_id),
    labelSnapshot,
    allocationMode: allocationMode as CatalogServiceWorkAllocationMode,
    allocationValue: Number.isFinite(allocationValue) && allocationValue > 0 ? allocationValue : 1,
    sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : index,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata as Record<string, unknown>
      : {},
  }
}

function normalizeService(record: Record<string, unknown>, serviceId: string): ServiceFormValues {
  const mediaSource = Array.isArray(record.media) ? record.media : []
  const workSource = Array.isArray(record.workRequirements) ? record.workRequirements : []
  const mediaItems = mediaSource
    .map((item) => item && typeof item === 'object' ? normalizeServiceMediaItem(item as Record<string, unknown>) : null)
    .filter((item): item is NonNullable<ReturnType<typeof normalizeServiceMediaItem>> => item !== null)
  const workRequirements = workSource
    .map((item, index) => item && typeof item === 'object' ? normalizeWorkRequirement(item as Record<string, unknown>, index) : null)
    .filter((item): item is ServiceWorkRequirementDraft => item !== null)
  const customValues = extractCustomFieldEntries(record)
  return createServiceInitialValues({
    id: text(record.id) ?? serviceId,
    title: text(record.title) ?? '',
    description: text(record.description) ?? '',
    scope: text(record.scope) ?? '',
    categoryId: text(record.categoryId) ?? text(record.category_id) ?? '',
    defaultPriceAmount: text(record.defaultPriceAmount) ?? text(record.default_price_amount) ?? '',
    defaultPriceCurrencyCode: text(record.defaultPriceCurrencyCode) ?? text(record.default_price_currency_code) ?? '',
    defaultMediaId: text(record.defaultMediaId) ?? text(record.default_media_id),
    defaultMediaUrl: text(record.defaultMediaUrl) ?? text(record.default_media_url) ?? '',
    mediaDraftId: serviceId,
    mediaItems,
    workRequirements,
    isActive: bool(record.isActive ?? record.is_active, true),
    updatedAt: text(record.updatedAt) ?? text(record.updated_at),
    ...customValues,
  })
}

export default function EditCatalogServicePage({ params }: { params?: { id?: string } }) {
  const serviceId = params?.id ?? ''
  const t = useT()
  const [initialValues, setInitialValues] = React.useState<ServiceFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    if (!serviceId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const { ok, status, result } = await apiCall<ServiceResponse>(
          `/api/catalog/services?ids=${encodeURIComponent(serviceId)}&page=1&pageSize=1`,
        )
        if (!ok) {
          if (status === 404) {
            if (!cancelled) setIsNotFound(true)
            return
          }
          throw new Error(t('catalog.services.form.errors.load', 'Failed to load service'))
        }
        const record = Array.isArray(result?.items) ? result.items[0] : null
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitialValues(normalizeService(record, serviceId))
      } catch (err) {
        if (!cancelled) {
          const fallback = t('catalog.services.form.errors.load', 'Failed to load service')
          setError(err instanceof Error ? err.message : fallback)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [serviceId, t])

  if (!serviceId) {
    return (
      <Page>
        <PageBody>
          <p className="text-sm text-destructive">
            {t('catalog.services.form.errors.idRequired', 'Service identifier is required.')}
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
            label={t('catalog.services.form.errors.notFound', 'Service not found')}
            backHref="/backend/catalog/services"
            backLabel={t('catalog.services.form.actions.backToList', 'Back to services')}
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

  const values = initialValues ?? createServiceInitialValues({ id: serviceId, mediaDraftId: serviceId })

  return (
    <Page>
      <PageBody>
        <ServiceForm
          title={t('catalog.services.form.editTitle', 'Edit service')}
          submitLabel={t('catalog.services.form.action.save', 'Save')}
          initialValues={values}
          isLoading={loading}
          loadingMessage={t('catalog.services.form.loading', 'Loading service...')}
          optimisticLockUpdatedAt={values.updatedAt ?? null}
          successRedirect={`/backend/catalog/services?flash=${encodeURIComponent(t('catalog.services.flash.updated', 'Service updated'))}&type=success`}
          deleteRedirect={`/backend/catalog/services?flash=${encodeURIComponent(t('catalog.services.flash.deleted', 'Service archived'))}&type=success`}
          onSubmit={async (formValues) => {
            await updateCrud('catalog/services', buildServicePayload({ ...formValues, id: serviceId }, t))
          }}
          onDelete={async () => {
            await deleteCrud('catalog/services', serviceId, {
              errorMessage: t('catalog.services.form.errors.delete', 'Failed to delete service'),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
