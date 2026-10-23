import type { AwilixContainer } from 'awilix'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { getTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CUSTOMER_DICTIONARY_DEFAULTS } from './dictionaryDefaults'

const logger = createLogger('customers').child({ component: 'dictionary-labels' })

type DictionaryLabelEntry = {
  id: string
  value: string
  label: string
  organizationId: string
}

export function customerDictionaryLabelKey(kind: string, value: string): string {
  const token = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `customers.dictionaries.defaults.${kind}.${token}`
}

export async function localizeCustomerDictionaryEntries<T extends DictionaryLabelEntry>(
  entries: T[],
  options: { kind: string; locale: string; tenantId: string; container: AwilixContainer },
): Promise<T[]> {
  if (!entries.length) return []
  const dictionaryLocale = options.locale.toLowerCase().split('-')[0] as Locale
  const translate = createFallbackTranslator(await loadDictionary(dictionaryLocale))
  const defaults = Object.prototype.hasOwnProperty.call(CUSTOMER_DICTIONARY_DEFAULTS, options.kind)
    ? CUSTOMER_DICTIONARY_DEFAULTS[options.kind]
    : []
  const localized = entries.map((entry) => {
    const seeded = defaults.find((candidate) => candidate.value === entry.value && candidate.label === entry.label)
    const renewalQuarter = options.kind === 'renewal_quarter' ? /^(\d{4})_q([1-4])$/.exec(entry.value) : null
    const label = renewalQuarter && entry.label === `Q${renewalQuarter[2]} ${renewalQuarter[1]}`
      ? translate('customers.dictionaries.defaults.renewal_quarter.label', entry.label, {
          year: renewalQuarter[1], quarter: renewalQuarter[2],
        })
      : seeded ? translate(customerDictionaryLabelKey(options.kind, seeded.value), entry.label) : entry.label
    return {
      ...entry,
      label,
    }
  })
  const { overlay } = getTranslationOverlayPlugin()
  if (!overlay) return localized

  const organizationIds = new Set(localized.map((entry) => entry.organizationId))
  const labelsById = new Map<string, string>()
  for (const organizationId of organizationIds) {
    const items = localized.filter((entry) => entry.organizationId === organizationId)
    try {
      const translated = await overlay(items.map(({ id, label }) => ({ id, label })), {
        entityType: 'customers:customer_dictionary_entry',
        locale: options.locale,
        tenantId: options.tenantId,
        organizationId,
        container: options.container,
      })
      for (const item of translated) {
        if (typeof item.id === 'string' && typeof item.label === 'string' && item.label.trim()) {
          labelsById.set(item.id, item.label)
        }
      }
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.dictionary_translation_failed' })
      logger.warn('Translation overlay failed', { error })
    }
  }
  return localized.map((entry) => ({ ...entry, label: labelsById.get(entry.id) ?? entry.label }))
}
