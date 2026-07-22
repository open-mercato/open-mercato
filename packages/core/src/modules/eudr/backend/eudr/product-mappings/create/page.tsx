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
  speciesScientificName: string
  speciesCommonName: string
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
      layout: 'half',
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
      layout: 'half',
      label: translate('eudr.productMappings.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'hsCode',
      layout: 'half',
      label: translate('eudr.productMappings.form.hsCode'),
      type: 'text',
    },
    {
      id: 'speciesScientificName',
      layout: 'half',
      label: translate('eudr.productMappings.speciesScientificName'),
      type: 'text',
      description: translate('eudr.productMappings.speciesHint'),
      maxLength: 256,
      visibleWhen: { field: 'commodity', equals: 'wood' },
    },
    {
      id: 'speciesCommonName',
      layout: 'half',
      label: translate('eudr.productMappings.speciesCommonName'),
      type: 'text',
      maxLength: 256,
      visibleWhen: { field: 'commodity', equals: 'wood' },
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
      fields: [
        'productId',
        'commodity',
        'hsCode',
        'speciesScientificName',
        'speciesCommonName',
      ],
    },
    {
      id: 'classification',
      title: translate('eudr.common.classification'),
      column: 2,
      fields: [
        'isInScope',
      ],
    },
    {
      id: 'notes',
      title: translate('eudr.common.notes'),
      column: 2,
      fields: [
        'notes',
      ],
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
            speciesScientificName: '',
            speciesCommonName: '',
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
              ...(commodity === 'wood' ? {
                speciesScientificName: optionalText(values.speciesScientificName),
                speciesCommonName: optionalText(values.speciesCommonName),
              } : {}),
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
