"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ProductSelectField,
  commodityOptions,
  type ProductSnapshot,
} from '../../../../components/formConfig'
import type { EudrCommodity } from '../../../../data/validators'

type ProductMappingRecord = {
  id: string
  productId: string
  productSnapshot: ProductSnapshot | null
  commodity: EudrCommodity
  hsCode: string | null
  isInScope: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

type ProductMappingDetailResponse = {
  items?: ProductMappingRecord[]
}

type ProductMappingFormValues = {
  id: string
  productId: string
  productSnapshot: ProductSnapshot | null
  commodity: string
  hsCode: string
  isInScope: boolean
  notes: string
  updatedAt: string
} & Record<string, unknown>

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isProductSnapshot(value: unknown): value is ProductSnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getRouteId(params?: { id?: string }): string | null {
  const rawId = params?.id
  return typeof rawId === 'string' && rawId.trim().length ? rawId : null
}

export default function EditEudrProductMappingPage({ params }: { params?: { id?: string } }) {
  const translate = useT()
  const router = useRouter()
  const mappingId = React.useMemo(() => getRouteId(params), [params])
  const [record, setRecord] = React.useState<ProductMappingRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      if (!mappingId) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const call = await apiCall<ProductMappingDetailResponse>(
          `/api/eudr/product-mappings?id=${encodeURIComponent(mappingId)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setError(translate('eudr.productMappings.form.loadError'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (cancelled) return
        if (items.length === 0) {
          setNotFound(true)
          setRecord(null)
          return
        }
        setRecord(items[0])
      } catch {
        if (!cancelled) setError(translate('eudr.productMappings.form.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [mappingId, translate])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'productId',
      label: translate('eudr.productMappings.form.product'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue, setFormValue }) => (
        <ProductSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          onSnapshot={(snapshot) => setFormValue?.('productSnapshot', snapshot)}
          placeholder={translate('eudr.productMappings.form.productPlaceholder')}
          loadError={translate('eudr.productMappings.form.productLoadError')}
        />
      ),
    },
    {
      id: 'commodity',
      label: translate('eudr.productMappings.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'hsCode',
      label: translate('eudr.productMappings.form.hsCode'),
      type: 'text',
    },
    {
      id: 'isInScope',
      label: translate('eudr.productMappings.form.isInScope'),
      type: 'checkbox',
    },
    {
      id: 'notes',
      label: translate('eudr.productMappings.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.productMappings.form.details'),
      column: 1,
      fields: ['productId', 'commodity', 'hsCode', 'isInScope', 'notes'],
    },
  ], [translate])

  const initialValues = React.useMemo<ProductMappingFormValues | null>(() => {
    if (!record) return null
    return {
      id: record.id,
      productId: record.productId,
      productSnapshot: record.productSnapshot,
      commodity: record.commodity,
      hsCode: record.hsCode ?? '',
      isInScope: record.isInScope,
      notes: record.notes ?? '',
      updatedAt: record.updatedAt,
    }
  }, [record])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('eudr.productMappings.form.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={translate('eudr.productMappings.form.notFound')}
            backHref="/backend/eudr/product-mappings"
            backLabel={translate('eudr.productMappings.form.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record || !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('eudr.productMappings.form.loadError')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<ProductMappingFormValues>
          title={translate('eudr.productMappings.edit.title')}
          backHref="/backend/eudr/product-mappings"
          cancelHref="/backend/eudr/product-mappings"
          deleteRedirect="/backend/eudr/product-mappings"
          submitLabel={translate('eudr.productMappings.form.submitUpdate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          onSubmit={async (values) => {
            const productId = optionalText(values.productId)
            if (!productId) {
              const message = translate('eudr.productMappings.form.productRequired')
              throw createCrudFormError(message, { productId: message })
            }
            const commodity = optionalText(values.commodity)
            if (!commodity) {
              const message = translate('eudr.productMappings.form.commodityRequired')
              throw createCrudFormError(message, { commodity: message })
            }
            await updateCrud('eudr/product-mappings', {
              id: record.id,
              productId,
              commodity,
              hsCode: optionalText(values.hsCode),
              isInScope: values.isInScope !== false,
              notes: optionalText(values.notes),
              productSnapshot: isProductSnapshot(values.productSnapshot) ? values.productSnapshot : null,
            }, {
              errorMessage: translate('eudr.productMappings.form.updateError'),
            })
            flash(translate('eudr.productMappings.form.updateSuccess'), 'success')
            router.push('/backend/eudr/product-mappings')
          }}
          onDelete={async () => {
            await deleteCrud('eudr/product-mappings', record.id, {
              errorMessage: translate('eudr.productMappings.form.deleteError'),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
