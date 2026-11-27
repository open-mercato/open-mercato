import type { CrudFormGroup, CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import type { ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { formatLocaleDecimalInput } from '@open-mercato/shared/lib/number'
import { ExchangeRateInput, ExchangeRateMetadataList } from '../components/ExchangeRateFormFields'
import { MIN_SIGNIFICANT_DIGITS, decimalToNumber, decimalToString, isDecimalInput, parseDecimal, toDecimal } from '@open-mercato/shared/lib/decimal'

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
  metadata?: Record<string, unknown> | null,
): CrudFormGroup[] {
  const rateLabel = t('exchangeRates.form.field.rate')
  const hasMetadata = Boolean(metadata && Object.keys(metadata).length)
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
          type: 'custom',
          label: rateLabel,
          required: true,
          component: (props) => <ExchangeRateInput {...props} label={rateLabel} />,
        },
        {
          id: 'date',
          type: 'date',
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
            { value: 'average', label: t('exchangeRates.form.field.typeAverage') },
          ],
        },
        {
          id: 'isActive',
          type: 'checkbox',
          label: t('exchangeRates.form.field.isActive'),
        },
        ...(hasMetadata
          ? [
              {
                id: 'metadataDetails',
                type: 'custom' as const,
                label: t('exchangeRates.form.field.providerDetails'),
                component: () => <ExchangeRateMetadataList metadata={metadata as Record<string, unknown>} />,
              },
            ]
          : []),
      ],
    },
  ]
}

export type ValidatedExchangeRateForm = {
  fromCode: string
  toCode: string
  /** Float copy of `rateExact`; prefer the exact field. */
  rate: number
  rateExact: string
  date: Date
  source: string
}

/** Input of {@link buildExchangeRatePayload}; the pre-exact shape (numeric `rate`, no metadata) is still accepted. */
export type ExchangeRatePayloadInput = {
  fromCode: string
  toCode: string
  rate: number
  rateExact?: string
  date: Date
  source: string
  metadata?: Record<string, unknown> | null
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

  // A bare `YYYY-MM-DD` (or a legacy `YYYY-MM-DDTHH:MM[...]` datetime-local
  // value predating the UTC-midnight normalization) has no timezone
  // designator, so `new Date(...)` would parse it in the SERVER's local
  // timezone rather than UTC — a legacy "2026-10-30T11:00" on a server east
  // of UTC can round-trip to 2026-10-29 once truncated to UTC midnight.
  // Anchor directly on the calendar-date portion of the string so the result
  // never depends on the server's local timezone.
  const rawDate = values.date ? String(values.date) : ''
  const dateOnlyMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/)
  const parsedDate = dateOnlyMatch
    ? new Date(`${dateOnlyMatch[1]}T00:00:00.000Z`)
    : (rawDate ? new Date(rawDate) : null)

  if (!parsedDate || isNaN(parsedDate.getTime())) {
    throw createCrudFormError(t('exchangeRates.form.errors.invalidDate'), {
      date: t('exchangeRates.form.errors.invalidDate'),
    })
  }

  const date = new Date(parsedDate)
  date.setUTCHours(0, 0, 0, 0)

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

  const rateExact = decimalToString(rawRate)
  return { fromCode, toCode, rate: decimalToNumber(rateExact), rateExact, date, source }
}

export function buildExchangeRatePayload(values: Record<string, unknown>, validated: ExchangeRatePayloadInput) {
  return {
    fromCurrencyCode: validated.fromCode,
    toCurrencyCode: validated.toCode,
    rate: validated.rateExact ?? decimalToString(validated.rate),
    date: validated.date.toISOString(),
    source: validated.source,
    type: values.type && values.type !== '' ? values.type : null,
    ...(validated.metadata !== undefined ? { metadata: validated.metadata } : {}),
    isActive: values.isActive !== false,
  }
}

/** Rate for list display: at most 17 significant digits with the locale decimal separator; the raw value when it is not a decimal. */
export function formatRateForDisplay(rate: string, locale?: string): string {
  const parsed = parseDecimal(rate)
  return parsed ? formatLocaleDecimalInput(parsed.prec(MIN_SIGNIFICANT_DIGITS), locale) : rate
}

/** Stored exchange-rate dates are UTC midnight; format the UTC calendar day so zones west of UTC do not show the previous day. */
export function formatDateOnlyUtc(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
