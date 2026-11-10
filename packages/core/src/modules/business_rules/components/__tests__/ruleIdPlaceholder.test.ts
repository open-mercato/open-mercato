import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'

describe('manual rule ID guidance', () => {
  it.each(Object.entries({ en, pl, de, es, ko }))('shows a concrete ID example in %s', (_locale, messages) => {
    const example = messages['business_rules.rules.form.placeholders.ruleId']
    expect(example).not.toMatch(/AUTO.*GENER/)
    expect(example).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/)
    expect(example.length).toBeLessThanOrEqual(50)
    expect(messages['business_rules.rules.form.descriptions.ruleId']).toBeTruthy()
  })
})
