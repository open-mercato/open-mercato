"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { CategorySelect } from '../../../../components/categories/CategorySelect'

type CategoryFormValues = {
  name: string
  slug?: string
  description?: string
  parentId?: string | null
  isActive?: boolean
}

async function submitCategoryCreate(values: CategoryFormValues, t: (key: string, fallback?: string) => string) {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  if (!name) {
    const message = t('catalog.categories.form.errors.name', 'Provide the category name.')
    throw createCrudFormError(message, { name: message })
  }
  const slug = typeof values.slug === 'string' && values.slug.trim().length ? values.slug.trim() : undefined
  const description =
    typeof values.description === 'string' && values.description.trim().length
      ? values.description.trim()
      : undefined
  const parentId =
    typeof values.parentId === 'string' && values.parentId.trim().length
      ? values.parentId.trim()
      : null
  const customFields = collectCustomFieldValues(values as Record<string, unknown>)
  const payload: Record<string, unknown> = {
    name,
    slug,
    description,
    parentId,
    isActive: values.isActive !== false,
  }
  if (Object.keys(customFields).length > 0) payload.customFields = customFields
  await createCrud('catalog/categories', payload)
}

export default function CreateCatalogCategoryPage() {
  const t = useT()
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('catalog.categories.form.field.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('catalog.categories.form.field.namePlaceholder', 'e.g., Footwear'),
    },
    {
      id: 'slug',
      label: t('catalog.categories.form.field.slug', 'Slug'),
      type: 'text',
      description: t('catalog.categories.form.field.slugHelp', 'Lowercase identifier for URLs or imports.'),
    },
    {
      id: 'description',
      label: t('catalog.categories.form.field.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'parentId',
      label: t('catalog.categories.form.field.parent', 'Parent'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <CategorySelect
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(next ?? '')}
          includeEmptyOption
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    {
      id: 'isActive',
      label: t('catalog.categories.form.field.isActive', 'Active'),
      type: 'checkbox',
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('catalog.categories.form.group.details', 'Details'),
      column: 1,
      fields: ['name', 'slug', 'description', 'parentId', 'isActive'],
    },
    {
      id: 'custom',
      title: t('catalog.categories.form.group.custom', 'Custom data'),
      column: 2,
      kind: 'customFields',
    },
  ], [t])

  const successMessage = encodeURIComponent(t('catalog.categories.flash.created', 'Category created'))

  return (
    <Page>
      <PageBody>
        <CrudForm<CategoryFormValues>
          title={t('catalog.categories.form.createTitle', 'Create category')}
          backHref="/backend/catalog/categories"
          fields={fields}
          groups={groups}
          entityId={E.catalog.catalog_product_category}
          initialValues={{ name: '', slug: '', description: '', parentId: '', isActive: true }}
          submitLabel={t('catalog.categories.form.action.create', 'Create')}
          cancelHref="/backend/catalog/categories"
          successRedirect={`/backend/catalog/categories?flash=${successMessage}&type=success`}
          onSubmit={async (values) => {
            await submitCategoryCreate(values, t)
          }}
        />
      </PageBody>
    </Page>
  )
}
