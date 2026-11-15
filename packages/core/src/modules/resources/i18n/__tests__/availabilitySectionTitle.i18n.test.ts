import * as fs from 'node:fs'
import * as path from 'node:path'

// Regression for issue #8835: AvailabilityRulesEditor requests
// `${labelPrefix}.availability.section.title` and the resource detail page
// passes labelPrefix="resources.resources", but that exact key was missing
// from every resource locale dictionary — so non-English sessions rendered
// the English fallback "Availability" instead of a translated heading.
const AVAILABILITY_SECTION_TITLE_KEY = 'resources.resources.availability.section.title'

function loadLocale(locale: string): Record<string, string> {
  const file = path.join(__dirname, '..', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
}

describe('resources availability section title translation', () => {
  const en = loadLocale('en')

  it('defines the key in the English dictionary', () => {
    expect(en[AVAILABILITY_SECTION_TITLE_KEY]).toBe('Availability')
  })

  it.each(['pl', 'de', 'es', 'ko'])('%s translates the availability section title away from English', (locale) => {
    const messages = loadLocale(locale)
    const value = messages[AVAILABILITY_SECTION_TITLE_KEY]
    expect(typeof value).toBe('string')
    expect(value.trim().length).toBeGreaterThan(0)
    expect(value).not.toBe(en[AVAILABILITY_SECTION_TITLE_KEY])
  })
})
