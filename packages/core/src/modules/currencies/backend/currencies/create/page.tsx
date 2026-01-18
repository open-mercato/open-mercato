'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export default function CreateCurrencyPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('currencies.form.group.details'),
        fields: [
          {
            id: 'code',
            type: 'text',
            label: t('currencies.form.field.code'),
            placeholder: t('currencies.form.field.codePlaceholder'),
            required: true,
            maxLength: 3,
            helpText: t('currencies.form.field.codeHelp'),
          },
          {
            id: 'name',
            type: 'text',
            label: t('currencies.form.field.name'),
            placeholder: t('currencies.form.field.namePlaceholder'),
            required: true,
          },
          {
            id: 'symbol',
            type: 'text',
            label: t('currencies.form.field.symbol'),
            placeholder: t('currencies.form.field.symbolPlaceholder'),
          },
        ],
      },
      {
        id: 'formatting',
        column: 2,
        title: t('currencies.form.group.formatting'),
        fields: [
          {
            id: 'decimalPlaces',
            type: 'number',
            label: t('currencies.form.field.decimalPlaces'),
            defaultValue: 2,
            min: 0,
            max: 8,
          },
          {
            id: 'thousandsSeparator',
            type: 'text',
            label: t('currencies.form.field.thousandsSeparator'),
            placeholder: ',',
            maxLength: 5,
          },
          {
            id: 'decimalSeparator',
            type: 'text',
            label: t('currencies.form.field.decimalSeparator'),
            placeholder: '.',
            maxLength: 5,
          },
          {
            id: 'isBase',
            type: 'checkbox',
            label: t('currencies.form.field.isBase'),
          },
          {
            id: 'isActive',
            type: 'checkbox',
            label: t('currencies.form.field.isActive'),
            defaultValue: true,
          },
        ],
      },
    ],
    [t]
  )

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('currencies.create.title')}
          backHref="/backend/currencies"
          fields={[]}
          groups={groups}
          submitLabel={t('currencies.form.action.create')}
          cancelHref="/backend/currencies"
          onSubmit={async (values) => {
            // Validate currency code
            const code = String(values.code || '').trim().toUpperCase()
            if (!/^[A-Z]{3}$/.test(code)) {
              throw createCrudFormError(t('currencies.form.errors.codeFormat'), {
                code: t('currencies.form.errors.codeFormat'),
              })
            }

            const payload = {
              organizationId,
              tenantId,
              code,
              name: String(values.name || '').trim(),
              symbol: values.symbol ? String(values.symbol).trim() : null,
              decimalPlaces: values.decimalPlaces ? parseInt(String(values.decimalPlaces)) : 2,
              thousandsSeparator: values.thousandsSeparator ? String(values.thousandsSeparator) : null,
              decimalSeparator: values.decimalSeparator ? String(values.decimalSeparator) : null,
              isBase: !!values.isBase,
              isActive: values.isActive !== false,
            }

            await createCrud('currencies/currencies', payload)

            flash(t('currencies.flash.created'), 'success')
            router.push('/backend/currencies')
          }}
        />
      </PageBody>
    </Page>
  )
}
