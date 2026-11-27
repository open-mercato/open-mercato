/** @jest-environment node */
import { featureToggleFormSchema } from '../formConfig'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'

const KEY = 'feature_toggles.form.errors.identifierPattern'

describe('featureToggleFormSchema', () => {
  it.each(['checkout.express', 'customers.interactions.legacy-adapters', 'beta_flag'])(
    'accepts %p and keeps the other form values',
    (identifier) => {
      const parsed = featureToggleFormSchema.safeParse({ identifier, name: 'Flag', defaultValue: false })
      expect(parsed.success).toBe(true)
      expect(parsed.data).toMatchObject({ name: 'Flag', defaultValue: false })
    },
  )

  it.each(['Has.Uppercase', '1leading-digit', 'has space'])('rejects %p with the translatable message key', (identifier) => {
    const parsed = featureToggleFormSchema.safeParse({ identifier })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ['identifier'], message: KEY })])
  })

  it.each([
    ['en', en],
    ['pl', pl],
    ['de', de],
    ['es', es],
    ['ko', ko],
  ])('has a %s translation for the message key', (_locale, dict) => {
    expect((dict as Record<string, string>)[KEY]).toEqual(expect.any(String))
  })
})
