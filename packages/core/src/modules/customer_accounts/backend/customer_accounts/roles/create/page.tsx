"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type CreateCustomerRoleFormValues = {
  name: string
  slug: string
  description: string
  isDefault: boolean
  customerAssignable: boolean
} & Record<string, unknown>

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function CreateCustomerRolePage() {
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('customer_accounts.admin.roleCreate.fields.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('customer_accounts.admin.roleCreate.fields.namePlaceholder', 'e.g. Buyer'),
    },
    {
      id: 'slug',
      label: t('customer_accounts.admin.roleCreate.fields.slug', 'Slug'),
      type: 'text',
      required: true,
      placeholder: t('customer_accounts.admin.roleCreate.fields.slugPlaceholder', 'e.g. buyer'),
      description: t('customer_accounts.admin.roleCreate.fields.slugHint', 'Lowercase letters, numbers, hyphens, and underscores only.'),
    },
    {
      id: 'description',
      label: t('customer_accounts.admin.roleCreate.fields.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'isDefault',
      label: t('customer_accounts.admin.roleCreate.fields.isDefault', 'Default role (auto-assigned to new users)'),
      type: 'checkbox',
    },
    {
      id: 'customerAssignable',
      label: t('customer_accounts.admin.roleCreate.fields.customerAssignable', 'Customers can self-assign'),
      type: 'checkbox',
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('customer_accounts.admin.roleCreate.sections.details', 'Role Details'),
      column: 1,
      fields: ['name', 'slug', 'description'],
    },
    {
      id: 'options',
      title: t('customer_accounts.admin.roleCreate.sections.options', 'Options'),
      column: 1,
      fields: ['isDefault', 'customerAssignable'],
    },
  ], [t])

  const initialValues = React.useMemo<Partial<CreateCustomerRoleFormValues>>(() => ({
    name: '',
    slug: '',
    description: '',
    isDefault: false,
    customerAssignable: false,
  }), [])

  return (
    <Page>
      <PageBody>
        <CrudForm<CreateCustomerRoleFormValues>
          title={t('customer_accounts.admin.roleCreate.title', 'Create Customer Role')}
          backHref="/backend/customer_accounts/roles"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('customer_accounts.admin.roleCreate.actions.create', 'Create Role')}
          cancelHref="/backend/customer_accounts/roles"
          successRedirect={`/backend/customer_accounts/roles?flash=${encodeURIComponent(t('customer_accounts.admin.roleCreate.flash.created', 'Role created'))}&type=success`}
          onSubmit={async (values) => {
            const name = typeof values.name === 'string' ? values.name.trim() : ''
            const rawSlug = typeof values.slug === 'string' ? values.slug.trim() : ''
            const slug = rawSlug || slugify(name)

            if (!name) {
              throw createCrudFormError(
                t('customer_accounts.admin.roleCreate.error.nameRequired', 'Name is required'),
                { name: t('customer_accounts.admin.roleCreate.error.nameRequired', 'Name is required') },
              )
            }

            if (!slug) {
              throw createCrudFormError(
                t('customer_accounts.admin.roleCreate.error.slugRequired', 'Slug is required'),
                { slug: t('customer_accounts.admin.roleCreate.error.slugRequired', 'Slug is required') },
              )
            }

            if (!/^[a-z0-9_-]+$/.test(slug)) {
              const message = t('customer_accounts.admin.roleCreate.error.slugFormat', 'Slug must contain only lowercase letters, numbers, hyphens, and underscores')
              throw createCrudFormError(message, { slug: message })
            }

            const description = typeof values.description === 'string' ? values.description.trim() : undefined

            await createCrud('customer_accounts/admin/roles', {
              name,
              slug,
              description: description || undefined,
              isDefault: Boolean(values.isDefault),
              customerAssignable: Boolean(values.customerAssignable),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
