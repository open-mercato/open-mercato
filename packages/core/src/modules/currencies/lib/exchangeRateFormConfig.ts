import type { CrudFormGroup, CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import type { ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { isExchangeRateMetadataWithinLimit } from '../data/validators'
import { MIN_SIGNIFICANT_DIGITS, decimalToString, isDecimalInput, parseDecimal, toDecimal } from '@open-mercato/shared/lib/decimal'

const logger = createLogger('currencies').child({ component: 'exchange-rate-form' })

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
    logger.error('Failed to load currencies', { err: error })
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
          type: 'decimal',
          label: t('exchangeRates.form.field.rate'),
          placeholder: '1.0',
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
            { value: 'buy', label: t('exchangeRates.form.field.typeBuy') },
            { value: 'sell', label: t('exchangeRates.form.field.typeSell') },
          ],
        },
        {
          id: 'isActive',
          type: 'checkbox',
          label: t('exchangeRates.form.field.isActive'),
        },
        {
          id: 'metadata',
          type: 'textarea',
          label: t('exchangeRates.form.field.metadata'),
          placeholder: '{ "key": "value" }',
          required: false,
          description: t('exchangeRates.form.field.metadataHelp'),
        },
      ],
    },
  ]
}

export type ValidatedExchangeRateForm = {
  fromCode: string
  toCode: string
  rate: string
  date: Date
  source: string
  metadata: Record<string, unknown> | null
}

export function metadataToFormValue(metadata: Record<string, unknown> | null | undefined): string {
  return metadata ? JSON.stringify(metadata, null, 2) : ''
}

function parseMetadataFormValue(value: unknown, t: (key: string) => string): Record<string, unknown> | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createCrudFormError(t('exchangeRates.form.errors.invalidMetadata'), {
      metadata: t('exchangeRates.form.errors.invalidMetadata'),
    })
  }
  if (!isExchangeRateMetadataWithinLimit(parsed)) {
    throw createCrudFormError(t('exchangeRates.form.errors.metadataTooLarge'), {
      metadata: t('exchangeRates.form.errors.metadataTooLarge'),
    })
  }
  return parsed as Record<string, unknown>
}

export function validateExchangeRateForm(
  values: Record<string, unknown>,
  t: (key: string) => string,
): ValidatedExchangeRateForm {
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

  const rawRate = typeof values.rate === 'number' || typeof values.rate === 'string' ? values.rate : ''
  if (!isDecimalInput(rawRate) || !toDecimal(rawRate).gt(0)) {
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

  const metadata = parseMetadataFormValue(values.metadata, t)

  return { fromCode, toCode, rate: decimalToString(rawRate), date, source, metadata }
}

export function buildExchangeRatePayload(values: Record<string, unknown>, validated: ValidatedExchangeRateForm) {
  return {
    fromCurrencyCode: validated.fromCode,
    toCurrencyCode: validated.toCode,
    rate: validated.rate,
    date: validated.date.toISOString(),
    source: validated.source,
    type: values.type && values.type !== '' ? values.type : null,
    metadata: validated.metadata,
    isActive: values.isActive !== false,
  }
}

/** Rate for list display: at most 17 significant digits; the raw value when it is not a decimal. */
export function formatRateForDisplay(rate: string): string {
  const parsed = parseDecimal(rate)
  return parsed ? decimalToString(parsed.prec(MIN_SIGNIFICANT_DIGITS)) : rate
}
