/** @jest-environment node */

import { describe, expect, test } from '@jest/globals'
import en from '../../../../i18n/en.json'
import pl from '../../../../i18n/pl.json'
import de from '../../../../i18n/de.json'
import es from '../../../../i18n/es.json'
import ko from '../../../../i18n/ko.json'
import { CHANGED_FIELD_LABELS, translateChangedField } from '../widget.client'

const dictionaries: Record<string, Record<string, string>> = {
  en: en as Record<string, string>,
  pl: pl as Record<string, string>,
  de: de as Record<string, string>,
  es: es as Record<string, string>,
  ko: ko as Record<string, string>,
}

function translatorFor(locale: string) {
  const dict = dictionaries[locale]
  return (key: string, fallback?: string) => dict[key] ?? fallback ?? key
}

// Snapshot diffs persist raw column names; these are the document-level fields
// the timeline showed in English before #5456.
const DOCUMENT_FIELDS = [
  'billing_address_snapshot',
  'shipping_address_snapshot',
  'customer_snapshot',
  'metadata',
  'adjustments',
  'grand_total_gross_amount',
  'grand_total_net_amount',
  'outstanding_amount',
  'shipping_gross_amount',
  'shipping_net_amount',
  'subtotal_gross_amount',
  'subtotal_net_amount',
]

describe('document history changed-field labels', () => {
  test('every declared label key ships in all five locale dictionaries', () => {
    const missing: string[] = []
    for (const { key } of Object.values(CHANGED_FIELD_LABELS)) {
      for (const [locale, dict] of Object.entries(dictionaries)) {
        if (!(key in dict)) missing.push(`${locale}:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('translates document-level snapshot fields instead of humanizing them', () => {
    const translate = translatorFor('pl')
    for (const field of DOCUMENT_FIELDS) {
      const label = translateChangedField(translate, field)
      expect(label).toBe(dictionaries.pl[CHANGED_FIELD_LABELS[camelize(field)].key])
    }
  })

  test('still humanizes fields that have no declared label', () => {
    const translate = translatorFor('en')
    expect(translateChangedField(translate, 'some_unmapped_column')).toBe('Some Unmapped Column')
  })
})

function camelize(field: string): string {
  return field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
