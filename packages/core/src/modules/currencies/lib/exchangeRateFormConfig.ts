import type { CrudFormGroup, CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import type { ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

export type CurrencyOption = {
  id: string
  code: string
  name: string
  isActive: boolean
}

type ApiCallFn = <T>(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiCallResult<T>>

export async function loadCurrencyOptions(
  apiCallFn: ApiCallFn,
  query?: string,
): Promise<CrudFieldOption[]> {
  try {
    const params = new URLSearchParams()
    if (query) {
      params.set('search', query)
    }
    params.set('isActive', 'true')
    params.set('pageSize', '100')

    const call = await apiCallFn<{ items: CurrencyOption[] }>(
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
}

export function exchangeRateGroups(
  t: (key: string) => string,
  loadOptions: (query?: string) => Promise<CrudFieldOption[]>,
): CrudFormGroup[] {
  return [
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
          loadOptions,
          allowCustomValues: false,
          description: t('exchangeRates.form.field.fromCurrencyHelp'),
        },
        {
          id: 'toCurrencyCode',
          type: 'combobox',
          label: t('exchangeRates.form.field.toCurrency'),
          placeholder: t('exchangeRates.form.field.toCurrencyPlaceholder'),
          required: true,
          loadOptions,
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
  ]
}

export function validateExchangeRateForm(
  values: Record<string, unknown>,
  t: (key: string) => string,
): { fromCode: string; toCode: string; rate: number; date: Date; source: string } {
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

  const rate = parseFloat(String(values.rate || '0'))
  if (isNaN(rate) || rate <= 0) {
    throw createCrudFormError(t('exchangeRates.form.errors.invalidRate'), {
      rate: t('exchangeRates.form.errors.invalidRate'),
    })
  }

  const date = values.date ? new Date(String(values.date)) : null

  if (!date || isNaN(date.getTime())) {
    throw createCrudFormError(t('exchangeRates.form.errors.invalidDate'), {
      date: t('exchangeRates.form.errors.invalidDate'),
    })
  }

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

  return { fromCode, toCode, rate, date, source }
}

export function buildExchangeRatePayload(values: Record<string, unknown>, validated: {
  fromCode: string
  toCode: string
  rate: number
  date: Date
  source: string
}) {
  return {
    fromCurrencyCode: validated.fromCode,
    toCurrencyCode: validated.toCode,
    rate: validated.rate.toFixed(8),
    date: validated.date.toISOString(),
    source: validated.source,
    type: values.type && values.type !== '' ? values.type : null,
    isActive: values.isActive !== false,
  }
}
