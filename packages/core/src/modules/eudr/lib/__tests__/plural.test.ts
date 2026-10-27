import { translatePlural } from '../plural'

const EN_DICTIONARY: Record<string, string> = {
  'eudr.evidenceSubmissions.form.plotsSelectedCount.one': '{count} plot selected',
  'eudr.evidenceSubmissions.form.plotsSelectedCount.other': '{count} plots selected',
  'eudr.evidenceSubmissions.form.plotsSelectedCount': '{count} plots selected',
}

const PL_DICTIONARY: Record<string, string> = {
  'eudr.evidenceSubmissions.form.plotsSelectedCount.one': 'Wybrano {count} działkę',
  'eudr.evidenceSubmissions.form.plotsSelectedCount.few': 'Wybrano {count} działki',
  'eudr.evidenceSubmissions.form.plotsSelectedCount.many': 'Wybrano {count} działek',
  'eudr.evidenceSubmissions.form.plotsSelectedCount': 'Wybrano {count} działek',
}

function translatorFor(dictionary: Record<string, string>) {
  return (key: string, params?: string | Record<string, string | number>) => {
    const template = dictionary[key]
    if (!template) return key
    if (!params || typeof params === 'string') return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
  }
}

const KEY = 'eudr.evidenceSubmissions.form.plotsSelectedCount'

describe('translatePlural', () => {
  it('picks the English one/other forms', () => {
    const translate = translatorFor(EN_DICTIONARY)
    expect(translatePlural(translate, 'en', KEY, 1)).toBe('1 plot selected')
    expect(translatePlural(translate, 'en', KEY, 2)).toBe('2 plots selected')
  })

  it('picks the Polish one/few/many forms', () => {
    const translate = translatorFor(PL_DICTIONARY)
    expect(translatePlural(translate, 'pl', KEY, 1)).toBe('Wybrano 1 działkę')
    expect(translatePlural(translate, 'pl', KEY, 2)).toBe('Wybrano 2 działki')
    expect(translatePlural(translate, 'pl', KEY, 5)).toBe('Wybrano 5 działek')
    expect(translatePlural(translate, 'pl', KEY, 22)).toBe('Wybrano 22 działki')
  })

  it('falls back to the base key when no plural form exists', () => {
    const translate = translatorFor({ [KEY]: '{count} selected' })
    expect(translatePlural(translate, 'en', KEY, 3)).toBe('3 selected')
  })

  it('survives an invalid locale by falling back to English rules', () => {
    const translate = translatorFor(EN_DICTIONARY)
    expect(translatePlural(translate, 'not-a-locale-###', KEY, 1)).toBe('1 plot selected')
  })
})
