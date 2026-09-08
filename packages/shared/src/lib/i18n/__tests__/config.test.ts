import { defaultLocale, locales, type Locale } from '../config'

describe('supported application locales', () => {
  it('registers Korean without changing the default locale', () => {
    expect(locales).toEqual<Locale[]>(['en', 'pl', 'es', 'de', 'ko'])
    expect(defaultLocale).toBe('en')
  })
})
