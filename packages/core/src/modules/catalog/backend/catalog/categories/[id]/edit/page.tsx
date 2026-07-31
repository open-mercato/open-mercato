"use client"

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { E } from '#generated/entities.ids.generated'
import { CategorySelect } from '../../../../../components/categories/CategorySelect'
import { CategorySlugFieldSync } from '../../../../../components/categories/CategorySlugFieldSync'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'

type CategoryRow = {
  id: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  isActive: boolean
  updatedAt?: string | null
  updated_at?: string | null
  pathLabel?: string
}

type CategoryResponse = {
  items?: CategoryRow[]
}

type CategoryFormValues = {
  id?: string
  name: string
  slug?: string
  description?: string
  parentId?: string | null
  isActive?: boolean
  updatedAt?: string | null
}

async function submitCategoryUpdate(
  categoryId: string,
  values: CategoryFormValues,
  t: (key: string, fallback?: string) => string,
) {
  const resolvedId = typeof values.id === 'string' && values.id.length ? values.id : categoryId
  if (!resolvedId) {
    const message = t('catalog.categories.form.errors.idRequired', 'Category identifier is required.')
    throw createCrudFormError(message, { id: message })
  }
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
    id: resolvedId,
    name,
    slug,
    description,
    parentId,
    isActive: values.isActive !== false,
  }
  if (Object.keys(customFields).length > 0) payload.customFields = customFields
  await updateCrud('catalog/categories', payload)
}

export default function EditCatalogCategoryPage({ params }: { params?: { id?: string } }) {
  const categoryId = params?.id ?? ''
  const t = useT()
  const pathname = usePathname()
  const [initialValues, setInitialValues] = React.useState<CategoryFormValues | null>(null)
  const [pathLabel, setPathLabel] = React.useState<string>('')
  const [loading, setLoading] = React.useState<boolean>(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (!categoryId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const { ok, status, result } = await apiCall<CategoryResponse>(
          `/api/catalog/categories?view=manage&ids=${encodeURIComponent(categoryId)}&status=all&page=1&pageSize=1`,
        )
        if (!ok) {
          if (status === 404) {
            if (!cancelled) setIsNotFound(true)
            return
          }
          throw new Error(t('catalog.categories.form.errors.load', 'Failed to load category'))
        }
        const record = Array.isArray(result?.items) ? result.items?.[0] : null
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (cancelled) return
        const customValues = extractCustomFieldEntries(record as Record<string, unknown>)
        setInitialValues({
          id: record.id,
          name: record.name,
          slug: record.slug ?? '',
          description: record.description ?? '',
          parentId: record.parentId ?? '',
          isActive: record.isActive,
          updatedAt: record.updatedAt ?? record.updated_at ?? null,
          ...customValues,
        })
        setPathLabel(record.pathLabel ?? '')
      } catch (err) {
        if (!cancelled) {
          const fallback = t('catalog.categories.form.errors.load', 'Failed to load category')
          const message = err instanceof Error ? err.message : fallback
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [categoryId, t])

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
      component: (ctx) => <CategorySlugFieldSync {...ctx} />,
    },
    {
      id: 'custom',
      title: t('catalog.categories.form.group.custom', 'Custom data'),
      column: 2,
      kind: 'customFields',
    },
  ], [t])

  // Publish page-load record context to the AppShell-owned `backend:record:current`
  // mount so the enterprise record_locks widget resolves `catalog.category` + id
  // explicitly. The resourceKind mirrors the CrudForm `versionHistory` so the held
  // lock matches the save-time conflict surface for the same category.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'catalog.category',
      resourceId: categoryId || null,
      updatedAt: initialValues?.updatedAt ?? null,
      data: initialValues as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  if (!categoryId) {
    return (
      <Page>
        <PageBody>
          <p className="text-sm text-destructive">
            {t('catalog.categories.form.errors.idRequired', 'Category identifier is required.')}
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
            label={t('catalog.categories.form.errors.notFound', 'Category not found')}
            backHref="/backend/catalog/categories"
            backLabel={t('catalog.categories.form.actions.backToList', 'Back to categories')}
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

  return (
    <Page>
      <PageBody>
        <CrudForm<CategoryFormValues>
          title={t('catalog.categories.form.editTitle', 'Edit category')}
          backHref="/backend/catalog/categories"
          versionHistory={{ resourceKind: 'catalog.category', resourceId: categoryId ? String(categoryId) : '' }}
          fields={fields}
          groups={groups}
          entityId={E.catalog.catalog_product_category}
          initialValues={initialValues ?? { id: categoryId, name: '', slug: '', description: '', parentId: '', isActive: true }}
          optimisticLockUpdatedAt={initialValues?.updatedAt}
          isLoading={loading}
          loadingMessage={t('catalog.categories.form.loading', 'Loading category...')}
          submitLabel={t('catalog.categories.form.action.save', 'Save')}
          cancelHref="/backend/catalog/categories"
          successRedirect={`/backend/catalog/categories?flash=${encodeURIComponent(t('catalog.categories.flash.updated', 'Category updated'))}&type=success`}
          extraActions={(
            <>
              <SendObjectMessageDialog
                object={{
                  entityModule: 'catalog',
                  entityType: 'category',
                  entityId: categoryId,
                  previewData: { title: initialValues?.name ?? categoryId },
                }}
                viewHref={`/backend/catalog/categories/${categoryId}/edit`}
              />
              {pathLabel ? (
                <span className="text-xs text-muted-foreground">
                  {t('catalog.categories.form.pathLabel', { path: pathLabel })}
                </span>
              ) : null}
            </>
          )}
          onSubmit={async (values) => {
            await submitCategoryUpdate(categoryId, values, t)
          }}
          onDelete={async () => {
            await deleteCrud('catalog/categories', categoryId, {
              errorMessage: t('catalog.categories.form.errors.delete', 'Failed to delete category'),
            })
          }}
          deleteRedirect={`/backend/catalog/categories?flash=${encodeURIComponent(t('catalog.categories.flash.deleted', 'Category archived'))}&type=success`}
        />
      </PageBody>
    </Page>
  )
}
