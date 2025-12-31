'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type CurrencyOption = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export default function CreateExchangeRatePage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const [currencyOptions, setCurrencyOptions] = React.useState<CrudFieldOption[]>([])

  // Load active currencies on mount
  React.useEffect(() => {
    async function loadCurrencies() {
      try {
        const params = new URLSearchParams()
        params.set('isActive', 'true')
        params.set('pageSize', '100')

        const call = await apiCall<{ items: CurrencyOption[] }>(
          `/api/currencies/currencies?${params.toString()}`
        )

        if (call.ok && call.result?.items) {
          const options = call.result.items.map((c) => ({
            value: c.code,
            label: `${c.code} - ${c.name}`,
          }))
          setCurrencyOptions(options)
        }
      } catch (error) {
        console.error('Failed to load currencies:', error)
      }
    }
    loadCurrencies()
  }, [])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'rate-details',
        column: 1,
        title: t('exchangeRates.form.group.details'),
        fields: [
          {
            id: 'fromCurrencyCode',
            type: 'combobox',
            label: t('exchangeRates.form.field.fromCurrency'),
            placeholder: t('exchangeRates.form.field.fromCurrencyPlaceholder'),
            required: true,
            suggestions: currencyOptions.map((o) => o.value),
            allowCustomValues: false,
            description: t('exchangeRates.form.field.fromCurrencyHelp'),
          },
          {
            id: 'toCurrencyCode',
            type: 'combobox',
            label: t('exchangeRates.form.field.toCurrency'),
            placeholder: t('exchangeRates.form.field.toCurrencyPlaceholder'),
            required: true,
            suggestions: currencyOptions.map((o) => o.value),
            allowCustomValues: false,
            description: t('exchangeRates.form.field.toCurrencyHelp'),
          },
          {
            id: 'rate',
            type: 'number',
            label: t('exchangeRates.form.field.rate'),
            placeholder: '1.00000000',
            required: true,
            description: t('exchangeRates.form.field.rateHelp'),
          },
          {
            id: 'date',
            type: 'text',
            label: t('exchangeRates.form.field.date'),
            required: true,
            description: t('exchangeRates.form.field.dateHelp'),
            placeholder: 'YYYY-MM-DDTHH:MM',
          },
        ],
      },
      {
        id: 'metadata',
        column: 2,
        title: t('exchangeRates.form.group.metadata'),
        fields: [
          {
            id: 'source',
            type: 'text',
            label: t('exchangeRates.form.field.source'),
            placeholder: t('exchangeRates.form.field.sourcePlaceholder'),
            required: true,
            description: t('exchangeRates.form.field.sourceHelp'),
          },
          {
            id: 'isActive',
            type: 'checkbox',
            label: t('exchangeRates.form.field.isActive'),
            defaultValue: true,
          },
        ],
      },
    ],
    [t, currencyOptions]
  )

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('exchangeRates.create.title')}
          backHref="/backend/exchange-rates"
          fields={[]}
          groups={groups}
          submitLabel={t('exchangeRates.form.action.create')}
          cancelHref="/backend/exchange-rates"
          onSubmit={async (values) => {
            // Validate currency codes
            const fromCode = String(values.fromCurrencyCode || '').trim().toUpperCase()
            const toCode = String(values.toCurrencyCode || '').trim().toUpperCase()

            if (!/^[A-Z]{3}$/.test(fromCode)) {
              throw createCrudFormError(t('exchangeRates.form.errors.fromCurrencyFormat'), {
                fromCurrencyCode: t('exchangeRates.form.errors.currencyCodeFormat'),
              })
            }

            if (!/^[A-Z]{3}$/.test(toCode)) {
              throw createCrudFormError(t('exchangeRates.form.errors.toCurrencyFormat'), {
                toCurrencyCode: t('exchangeRates.form.errors.currencyCodeFormat'),
              })
            }

            if (fromCode === toCode) {
              throw createCrudFormError(t('exchangeRates.form.errors.sameCurrency'), {
                toCurrencyCode: t('exchangeRates.form.errors.sameCurrency'),
              })
            }

            // Validate rate
            const rate = parseFloat(String(values.rate || '0'))
            if (isNaN(rate) || rate <= 0) {
              throw createCrudFormError(t('exchangeRates.form.errors.invalidRate'), {
                rate: t('exchangeRates.form.errors.invalidRate'),
              })
            }

            // Validate date
            const date = values.date ? new Date(String(values.date)) : null

            if (!date || isNaN(date.getTime())) {
              throw createCrudFormError(t('exchangeRates.form.errors.invalidDate'), {
                date: t('exchangeRates.form.errors.invalidDate'),
              })
            }

            // Validate source
            const source = String(values.source || '').trim()
            if (!source || source.length < 2) {
              throw createCrudFormError(t('exchangeRates.form.errors.sourceTooShort'), {
                source: t('exchangeRates.form.errors.sourceTooShort'),
              })
            }
            if (source.length > 50) {
              throw createCrudFormError(t('exchangeRates.form.errors.sourceTooLong'), {
                source: t('exchangeRates.form.errors.sourceTooLong'),
              })
            }
            if (!/^[a-zA-Z0-9\s\-_]+$/.test(source)) {
              throw createCrudFormError(t('exchangeRates.form.errors.sourceInvalidFormat'), {
                source: t('exchangeRates.form.errors.sourceInvalidFormat'),
              })
            }

            const payload = {
              organizationId,
              tenantId,
              fromCurrencyCode: fromCode,
              toCurrencyCode: toCode,
              rate: rate.toFixed(8),
              date: date.toISOString(),
              source,
              isActive: values.isActive !== false,
            }

            const { result } = await createCrud('currencies/exchange-rates', payload)

            flash(t('exchangeRates.flash.created'), 'success')
            router.push('/backend/exchange-rates')
          }}
        />
      </PageBody>
    </Page>
  )
}
