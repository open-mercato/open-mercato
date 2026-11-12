import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getPriorityFallbackLabel, getPriorityLabelKey, getPriorityOptions } from '../priorityUtils'

const i18nDir = join(__dirname, '..', '..', 'i18n')
const locales = readdirSync(i18nDir).filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''))

function loadDictionary(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8'))
}

describe('priorityUtils', () => {
  it('derives stable label keys for every priority', () => {
    for (const { value, labelKey, fallbackLabel } of getPriorityOptions()) {
      expect(labelKey).toBe(`messages.priority.${value}`)
      expect(fallbackLabel).toBe(getPriorityFallbackLabel(value))
    }
  })
})

// Regression for #8800: the PriorityBadge tooltip/aria-label falls back to the English
// label whenever a locale dictionary is missing `messages.priority.<value>`, so every
// supported locale leaked English priority names regardless of the active language.
describe('messages.priority.<value> is translated in every supported locale (#8800)', () => {
  it('is present and non-empty for every priority in every locale dictionary', () => {
    for (const locale of locales) {
      const dictionary = loadDictionary(locale)
      for (const { value } of getPriorityOptions()) {
        const key = getPriorityLabelKey(value)
        expect(typeof dictionary[key]).toBe('string')
        expect(dictionary[key]!.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('translates every priority for the Polish dictionary required by QA8514-PL-PRIORITY-001', () => {
    const pl = loadDictionary('pl')
    expect(pl['messages.priority.low']).toBe('Niski')
    expect(pl['messages.priority.normal']).toBe('Normalny')
    expect(pl['messages.priority.high']).toBe('Wysoki')
    expect(pl['messages.priority.urgent']).toBe('Pilny')
  })
})
