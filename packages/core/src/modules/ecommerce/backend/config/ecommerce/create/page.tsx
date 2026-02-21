'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type StoreFormValues = {
  name: string
  code: string
  slug: string
  status: string
  defaultLocale: string
  supportedLocales: string
  defaultCurrencyCode: string
  isPrimary: boolean
}

export default function CreateEcommerceStorePage() {
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('ecommerce.stores.fields.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('ecommerce.stores.form.placeholders.name', 'e.g., My Online Store'),
    },
    {
      id: 'code',
      label: t('ecommerce.stores.fields.code', 'Code'),
      type: 'text',
      required: true,
      placeholder: t('ecommerce.stores.form.placeholders.code', 'e.g., my_store'),
      description: t('ecommerce.stores.form.descriptions.code', 'Lowercase, alphanumeric with dashes/underscores.'),
    },
    {
      id: 'slug',
      label: t('ecommerce.stores.fields.slug', 'Slug'),
      type: 'text',
      required: true,
      placeholder: t('ecommerce.stores.form.placeholders.slug', 'e.g., my-store'),
      description: t('ecommerce.stores.form.descriptions.slug', 'Used in storefront URLs.'),
    },
    {
      id: 'status',
      label: t('ecommerce.stores.fields.status', 'Status'),
      type: 'select',
      options: [
        { value: 'draft', label: t('ecommerce.stores.status.draft', 'Draft') },
        { value: 'active', label: t('ecommerce.stores.status.active', 'Active') },
        { value: 'archived', label: t('ecommerce.stores.status.archived', 'Archived') },
      ],
    },
    {
      id: 'defaultLocale',
      label: t('ecommerce.stores.fields.defaultLocale', 'Default Locale'),
      type: 'text',
      placeholder: t('ecommerce.stores.form.placeholders.defaultLocale', 'e.g., en'),
    },
    {
      id: 'supportedLocales',
      label: t('ecommerce.stores.fields.supportedLocales', 'Supported Locales'),
      type: 'text',
      placeholder: t('ecommerce.stores.form.placeholders.supportedLocales', 'e.g., en, pl, de'),
      description: t('ecommerce.stores.form.descriptions.supportedLocales', 'Comma-separated locale codes.'),
    },
    {
      id: 'defaultCurrencyCode',
      label: t('ecommerce.stores.fields.defaultCurrencyCode', 'Default Currency'),
      type: 'text',
      placeholder: t('ecommerce.stores.form.placeholders.defaultCurrencyCode', 'e.g., USD'),
    },
    {
      id: 'isPrimary',
      label: t('ecommerce.stores.fields.isPrimary', 'Primary Store'),
      type: 'checkbox',
      description: t('ecommerce.stores.form.descriptions.isPrimary', 'Primary store is used when no domain matches.'),
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identity',
      title: t('ecommerce.stores.form.groups.identity', 'Identity'),
      column: 1,
      fields: ['name', 'code', 'slug', 'status'],
    },
    {
      id: 'locale',
      title: t('ecommerce.stores.form.groups.locale', 'Locale & Currency'),
      column: 2,
      fields: ['defaultLocale', 'supportedLocales', 'defaultCurrencyCode', 'isPrimary'],
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<StoreFormValues>
          title={t('ecommerce.stores.create', 'Create Store')}
          backHref="/backend/config/ecommerce"
          fields={fields}
          groups={groups}
          initialValues={{
            name: '',
            code: '',
            slug: '',
            status: 'draft',
            defaultLocale: 'en',
            supportedLocales: 'en',
            defaultCurrencyCode: 'USD',
            isPrimary: false,
          }}
          submitLabel={t('ecommerce.stores.form.submit', 'Create Store')}
          cancelHref="/backend/config/ecommerce"
          successRedirect="/backend/config/ecommerce"
          onSubmit={async (values) => {
            const name = values.name?.trim() ?? ''
            if (!name) {
              const msg = t('ecommerce.stores.form.errors.name', 'Store name is required.')
              throw createCrudFormError(msg, { name: msg })
            }
            const code = values.code?.trim() ?? ''
            if (!code) {
              const msg = t('ecommerce.stores.form.errors.code', 'Store code is required.')
              throw createCrudFormError(msg, { code: msg })
            }
            const slug = values.slug?.trim() ?? ''
            if (!slug) {
              const msg = t('ecommerce.stores.form.errors.slug', 'Store slug is required.')
              throw createCrudFormError(msg, { slug: msg })
            }
            const supportedLocales = (values.supportedLocales ?? '')
              .split(',')
              .map((l) => l.trim())
              .filter(Boolean)
            await createCrud('ecommerce/stores', {
              name,
              code,
              slug,
              status: values.status || 'draft',
              defaultLocale: values.defaultLocale?.trim() || 'en',
              supportedLocales: supportedLocales.length ? supportedLocales : ['en'],
              defaultCurrencyCode: (values.defaultCurrencyCode?.trim() || 'USD').toUpperCase(),
              isPrimary: values.isPrimary ?? false,
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
