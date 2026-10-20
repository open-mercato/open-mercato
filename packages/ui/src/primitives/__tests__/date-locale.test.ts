import { de } from 'date-fns/locale/de'
import { enUS } from 'date-fns/locale/en-US'
import { es } from 'date-fns/locale/es'
import { ko } from 'date-fns/locale/ko'
import { pl } from 'date-fns/locale/pl'
import { deriveTimeDisplayFormat, resolveDateFnsLocale } from '../date-locale'

describe('resolveDateFnsLocale', () => {
  it('maps every locale the app ships to its date-fns locale', () => {
    expect(resolveDateFnsLocale('en')).toBe(enUS)
    expect(resolveDateFnsLocale('pl')).toBe(pl)
    expect(resolveDateFnsLocale('de')).toBe(de)
    expect(resolveDateFnsLocale('es')).toBe(es)
    expect(resolveDateFnsLocale('ko')).toBe(ko)
  })

  it('resolves a region-qualified code by its language', () => {
    expect(resolveDateFnsLocale('pl-PL')).toBe(pl)
    expect(resolveDateFnsLocale('en-GB')).toBe(enUS)
    expect(resolveDateFnsLocale('DE')).toBe(de)
  })

  it('returns undefined for an unmapped or absent locale so consumers keep their own default', () => {
    expect(resolveDateFnsLocale('fr')).toBeUndefined()
    expect(resolveDateFnsLocale('')).toBeUndefined()
    expect(resolveDateFnsLocale(null)).toBeUndefined()
    expect(resolveDateFnsLocale(undefined)).toBeUndefined()
  })

  it('resolves a locale that starts the week on Monday', () => {
    expect(resolveDateFnsLocale('pl')?.options?.weekStartsOn).toBe(1)
    expect(resolveDateFnsLocale('en')?.options?.weekStartsOn).toBe(0)
  })
})

describe('deriveTimeDisplayFormat', () => {
  it('reports 24h for locales that write time on a 24-hour clock', () => {
    expect(deriveTimeDisplayFormat('pl')).toBe('24h')
    expect(deriveTimeDisplayFormat('de')).toBe('24h')
    expect(deriveTimeDisplayFormat('es')).toBe('24h')
  })

  it('reports 12h for locales that use AM/PM — including Korean', () => {
    expect(deriveTimeDisplayFormat('en')).toBe('12h')
    expect(deriveTimeDisplayFormat('ko')).toBe('12h')
  })

  it('falls back to 12h when there is no locale or Intl cannot read it', () => {
    expect(deriveTimeDisplayFormat(undefined)).toBe('12h')
    expect(deriveTimeDisplayFormat(null)).toBe('12h')
    expect(deriveTimeDisplayFormat('not a locale tag')).toBe('12h')
  })
})
