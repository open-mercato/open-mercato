'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Formats a Date object to YYYY-MM-DDTHH:MM format in local timezone
 * for use with datetime-local input
 */
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

type ExchangeRateData = {
  id: string
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: string
  source: string | null
  type: string | null
  isActive: boolean
  organizationId: string
  tenantId: string
}

type CurrencyOption = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export default function EditExchangeRatePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()

  const [exchangeRate, setExchangeRate] = React.useState<ExchangeRateData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const loadCurrencyOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    try {
      const params = new URLSearchParams()
      if (query) {
        params.set('search', query)
      }
      params.set('isActive', 'true')
      params.set('pageSize', '100')

      const call = await apiCall<{ items: CurrencyOption[] }>(
        `/api/currencies/currencies?${params.toString()}`
      )

      if (call.ok && call.result?.items) {
        return call.result.items.map((c) => ({
          value: c.code,
          label: c.code,
        }))
      }
    } catch (error) {
      console.error('Failed to load currencies:', error)
    }
    return []
  }, [])

  // Load exchange rate data
  React.useEffect(() => {
    async function loadExchangeRate() {
      try {
        const response = await apiCall<{ items: ExchangeRateData[] }>(`/api/currencies/exchange-rates?id=${params?.id}`)
        if (response.ok && response.result && response.result.items.length > 0) {
          setExchangeRate(response.result.items[0])
        } else {
          setError(t('exchangeRates.form.errors.notFound'))
        }
      } catch (err) {
        setError(t('exchangeRates.form.errors.load'))
      } finally {
        setLoading(false)
      }
    }
    loadExchangeRate()
  }, [params, t])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'rate-details',
        column: 1,
        fields: [
          {
            id: 'fromCurrencyCode',
            type: 'combobox',
            label: t('exchangeRates.form.field.fromCurrency'),
            placeholder: t('exchangeRates.form.field.fromCurrencyPlaceholder'),
            required: true,
            loadOptions: loadCurrencyOptions,
            allowCustomValues: false,
            description: t('exchangeRates.form.field.fromCurrencyHelp'),
          },
          {
            id: 'toCurrencyCode',
            type: 'combobox',
            label: t('exchangeRates.form.field.toCurrency'),
            placeholder: t('exchangeRates.form.field.toCurrencyPlaceholder'),
            required: true,
            loadOptions: loadCurrencyOptions,
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
            type: 'datetime-local',
            label: t('exchangeRates.form.field.date'),
            required: true,
            description: t('exchangeRates.form.field.dateHelp'),
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
            id: 'type',
            type: 'select',
            label: t('exchangeRates.form.field.type'),
            placeholder: t('exchangeRates.form.field.typePlaceholder'),
            required: false,
            description: t('exchangeRates.form.field.typeHelp'),
            options: [
              { value: '', label: t('exchangeRates.form.field.typeNone') },
              { value: 'buy', label: t('exchangeRates.form.field.typeBuy') },
              { value: 'sell', label: t('exchangeRates.form.field.typeSell') },
            ],
          },
          {
            id: 'isActive',
            type: 'checkbox',
            label: t('exchangeRates.form.field.isActive'),
          },
        ],
      },
    ],
    [t, loadCurrencyOptions]
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center p-8">
            <div className="text-muted-foreground">{t('exchangeRates.form.loading')}</div>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !exchangeRate) {
    return (
      <Page>
        <PageBody>
          <div className="text-destructive">{error || t('exchangeRates.form.errors.notFound')}</div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('exchangeRates.edit.title')}
          backHref="/backend/exchange-rates"
          versionHistory={{ resourceKind: 'currencies.exchange_rate', resourceId: exchangeRate.id }}
          fields={[]}
          groups={groups}
          initialValues={{
            fromCurrencyCode: exchangeRate.fromCurrencyCode,
            toCurrencyCode: exchangeRate.toCurrencyCode,
            rate: parseFloat(exchangeRate.rate),
            date: formatDateTimeLocal(new Date(exchangeRate.date)),
            source: exchangeRate.source || '',
            type: exchangeRate.type || '',
            isActive: exchangeRate.isActive,
          }}
          submitLabel={t('exchangeRates.form.action.save')}
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
              id: exchangeRate.id,
              fromCurrencyCode: fromCode,
              toCurrencyCode: toCode,
              rate: rate.toFixed(8),
              date: date.toISOString(),
              source,
              type: values.type && values.type !== '' ? values.type : null,
              isActive: values.isActive !== false,
            }

            await updateCrud('currencies/exchange-rates', payload)

            flash(t('exchangeRates.flash.updated'), 'success')
            router.push('/backend/exchange-rates')
          }}
        />
      </PageBody>
    </Page>
  )
}
