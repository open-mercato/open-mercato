import de from '../modules/onboarding/i18n/de.json'
import en from '../modules/onboarding/i18n/en.json'
import es from '../modules/onboarding/i18n/es.json'
import pl from '../modules/onboarding/i18n/pl.json'

type LocaleMessages = Record<string, string>

const locales: Record<string, LocaleMessages> = {
  de: de as LocaleMessages,
  en: en as LocaleMessages,
  es: es as LocaleMessages,
  pl: pl as LocaleMessages,
}

const consentKeys = ['onboarding.form.marketingLabel', 'demoFeedback.form.marketingLabel']
const controllerName = 'Open Mercato sp. z o.o.'
const supersededController = 'CT Tornado'
const registrationIdentifiers = ['0001253104', 'PL8982336029', '545230330']

describe('marketing consent controller identity', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    describe(locale, () => {
      for (const key of consentKeys) {
        it(`names the current controller in ${key}`, () => {
          const label = messages[key]
          expect(typeof label).toBe('string')
          expect(label).toContain(controllerName)
          expect(label).not.toContain(supersededController)
        })
      }

      it('discloses the controller registration details', () => {
        const disclosure = messages['onboarding.form.legalEntity']
        expect(typeof disclosure).toBe('string')
        expect(disclosure).toContain(controllerName)
        for (const identifier of registrationIdentifiers) {
          expect(disclosure).toContain(identifier)
        }
      })
    })
  }

  it('keeps the legal entity disclosure present in every shipped locale', () => {
    const missing = Object.entries(locales)
      .filter(([, messages]) => !messages['onboarding.form.legalEntity'])
      .map(([locale]) => locale)
    expect(missing).toEqual([])
  })
})
