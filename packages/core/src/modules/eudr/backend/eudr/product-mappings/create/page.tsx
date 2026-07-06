"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ProductSelectField,
  commodityOptions,
  type ProductSnapshot,
} from '../../../../components/formConfig'

type ProductMappingFormValues = {
  productId: string
  productSnapshot: ProductSnapshot | null
  commodity: string
  hsCode: string
  isInScope: boolean
  notes: string
} & Record<string, unknown>

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isProductSnapshot(value: unknown): value is ProductSnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export default function CreateEudrProductMappingPage() {
  const translate = useT()
  const router = useRouter()

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
      defaultValue: true,
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

  return (
    <Page>
      <PageBody>
        <CrudForm<ProductMappingFormValues>
          title={translate('eudr.productMappings.create.title')}
          backHref="/backend/eudr/product-mappings"
          cancelHref="/backend/eudr/product-mappings"
          submitLabel={translate('eudr.productMappings.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={{
            productId: '',
            productSnapshot: null,
            commodity: '',
            hsCode: '',
            isInScope: true,
            notes: '',
          }}
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
            await createCrud('eudr/product-mappings', {
              productId,
              commodity,
              hsCode: optionalText(values.hsCode),
              isInScope: values.isInScope !== false,
              notes: optionalText(values.notes),
              productSnapshot: isProductSnapshot(values.productSnapshot) ? values.productSnapshot : null,
            }, {
              errorMessage: translate('eudr.productMappings.form.createError'),
            })
            flash(translate('eudr.productMappings.form.createSuccess'), 'success')
            router.push('/backend/eudr/product-mappings')
          }}
        />
      </PageBody>
    </Page>
  )
}
