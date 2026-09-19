"use client"

import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { ISO_COUNTRIES } from '@open-mercato/shared/lib/location/countries'
import {
  ADDRESS_LAYOUTS,
  CURRENCY_DISPLAYS,
  DISPLAY_HOUR_CYCLES,
  LENGTH_DISPLAYS,
  MEASUREMENT_SYSTEMS,
  NEGATIVE_STYLES,
  PAPER_SIZES,
  PRICE_PRESENTATIONS,
} from '@open-mercato/shared/lib/display/profile'

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

type Translate = TranslateFn

function options(values: readonly string[], t: Translate, prefix: string) {
  return values.map((value) => ({ value, label: t(`markets.option.${prefix}.${value}`) }))
}

const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6'] as const

/**
 * IANA zones come from the runtime rather than a vendored list, so the picker cannot offer a zone
 * the validator would then reject.
 */
function timeZoneOptions(): { value: string; label: string }[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supported === 'function') {
      return supported('timeZone').map((zone) => ({ value: zone, label: zone }))
    }
  } catch {
    // Fall through to a short list rather than leaving the field unusable.
  }
  return ['UTC', 'America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/Warsaw', 'Europe/Berlin']
    .map((zone) => ({ value: zone, label: zone }))
}

export type MarketProfileSection = {
  id: string
  titleKey: string
  fields: CrudField[]
}

export function buildMarketProfileSections(t: Translate): MarketProfileSection[] {
  const countryOptions = ISO_COUNTRIES.map((country) => ({ value: country.code, label: country.name }))

  return [
    {
      id: 'languageCurrency',
      titleKey: 'markets.settings.group.languageCurrency',
      fields: [
        { id: 'name', type: 'text', label: t('markets.field.name'), required: true },
        { id: 'languageTag', type: 'text', label: t('markets.field.languageTag'), required: true, placeholder: 'en-US' },
        { id: 'currencyCode', type: 'text', label: t('markets.field.currencyCode'), required: true, maxLength: 3, placeholder: 'USD' },
        { id: 'currencyDisplay', type: 'select', label: t('markets.field.currencyDisplay'), required: true, options: options(CURRENCY_DISPLAYS, t, 'currencyDisplay') },
        { id: 'decimalSeparator', type: 'text', label: t('markets.field.decimalSeparator'), maxLength: 1, placeholder: '.' },
        { id: 'thousandsSeparator', type: 'text', label: t('markets.field.thousandsSeparator'), maxLength: 1, placeholder: ',' },
        { id: 'negativeStyle', type: 'select', label: t('markets.field.negativeStyle'), required: true, options: options(NEGATIVE_STYLES, t, 'negativeStyle') },
      ],
    },
    {
      id: 'datesTimes',
      titleKey: 'markets.settings.group.datesTimes',
      fields: [
        { id: 'dateFormat', type: 'text', label: t('markets.field.dateFormat'), required: true, placeholder: 'MM/dd/yyyy' },
        { id: 'dateTimeFormat', type: 'text', label: t('markets.field.dateTimeFormat'), required: true, placeholder: 'MM/dd/yyyy h:mm a' },
        { id: 'timeFormat', type: 'text', label: t('markets.field.timeFormat'), required: true, placeholder: 'h:mm a' },
        { id: 'hourCycle', type: 'select', label: t('markets.field.hourCycle'), required: true, options: options(DISPLAY_HOUR_CYCLES, t, 'hourCycle') },
        {
          id: 'firstDayOfWeek',
          type: 'select',
          label: t('markets.field.firstDayOfWeek'),
          required: true,
          options: WEEKDAYS.map((day) => ({ value: day, label: t(`markets.option.weekday.${day}`) })),
        },
        { id: 'timeZone', type: 'select', label: t('markets.field.timeZone'), required: true, options: timeZoneOptions() },
      ],
    },
    {
      id: 'addresses',
      titleKey: 'markets.settings.group.addresses',
      fields: [
        { id: 'addressLayout', type: 'select', label: t('markets.field.addressLayout'), required: true, options: options(ADDRESS_LAYOUTS, t, 'addressLayout') },
        { id: 'defaultCountryCode', type: 'select', label: t('markets.field.defaultCountryCode'), required: true, options: countryOptions },
        { id: 'subdivisionRequired', type: 'checkbox', label: t('markets.field.subdivisionRequired') },
        { id: 'postalCodePattern', type: 'text', label: t('markets.field.postalCodePattern'), placeholder: '^\\d{5}(-\\d{4})?$' },
        { id: 'phoneNationalPattern', type: 'text', label: t('markets.field.phoneNationalPattern'), placeholder: '(###) ###-####' },
        { id: 'phoneDefaultDialCode', type: 'text', label: t('markets.field.phoneDefaultDialCode'), placeholder: '+1' },
      ],
    },
    {
      id: 'units',
      titleKey: 'markets.settings.group.units',
      fields: [
        { id: 'measurementSystem', type: 'select', label: t('markets.field.measurementSystem'), required: true, options: options(MEASUREMENT_SYSTEMS, t, 'measurementSystem') },
        { id: 'defaultWeightUnit', type: 'text', label: t('markets.field.defaultWeightUnit'), required: true, placeholder: 'lb' },
        { id: 'defaultLengthUnit', type: 'text', label: t('markets.field.defaultLengthUnit'), required: true, placeholder: 'in' },
        { id: 'lengthDisplay', type: 'select', label: t('markets.field.lengthDisplay'), required: true, options: options(LENGTH_DISPLAYS, t, 'lengthDisplay') },
      ],
    },
    {
      id: 'documents',
      titleKey: 'markets.settings.group.documents',
      fields: [
        { id: 'paperSize', type: 'select', label: t('markets.field.paperSize'), required: true, options: options(PAPER_SIZES, t, 'paperSize') },
      ],
    },
    {
      id: 'pricesTax',
      titleKey: 'markets.settings.group.pricesTax',
      fields: [
        { id: 'pricePresentation', type: 'select', label: t('markets.field.pricePresentation'), required: true, options: options(PRICE_PRESENTATIONS, t, 'pricePresentation') },
      ],
    },
  ]
}
