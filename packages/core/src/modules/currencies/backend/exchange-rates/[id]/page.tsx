'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'

type ExchangeRateData = {
  id: string
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: string
  source: string | null
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
  const [currencyOptions, setCurrencyOptions] = React.useState<CrudFieldOption[]>([])

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

  // Load active currencies
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
          },
        ],
      },
    ],
    [t, currencyOptions]
  )

  const handleDelete = React.useCallback(async () => {
    if (!exchangeRate) return
    
    if (!confirm(t('exchangeRates.list.confirmDelete', { 
      pair: `${exchangeRate.fromCurrencyCode}/${exchangeRate.toCurrencyCode}` 
    }))) {
      return
    }

    try {
      await apiCall('/api/currencies/exchange-rates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: exchangeRate.id, 
          organizationId: exchangeRate.organizationId, 
          tenantId: exchangeRate.tenantId 
        }),
      })

      flash(t('exchangeRates.flash.deleted'), 'success')
      router.push('/backend/exchange-rates')
    } catch (error) {
      flash(t('exchangeRates.flash.deleteError'), 'error')
    }
  }, [exchangeRate, t, router])

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
          fields={[]}
          groups={groups}
          initialValues={{
            fromCurrencyCode: exchangeRate.fromCurrencyCode,
            toCurrencyCode: exchangeRate.toCurrencyCode,
            rate: parseFloat(exchangeRate.rate),
            date: new Date(exchangeRate.date).toLocaleString('sv-SE', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }).replace(' ', 'T').slice(0, 16),
            source: exchangeRate.source || '',
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
