import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COUNTRY_PRIORITY,
  ISO_COUNTRIES,
  buildCountryOptions,
  matchCountryCodes,
  resolveCountryName,
} from '../countries'

const PACKAGE_ROOT = join(__dirname, '..', '..', '..', '..')
const DIST_COUNTRIES = join(PACKAGE_ROOT, 'dist/lib/location/countries.js')
const DIST_GENERATED = join(PACKAGE_ROOT, 'dist/lib/location/countries.generated.js')

describe('ISO_COUNTRIES', () => {
  it('does not import language-subtag-registry at runtime (Node ESM / production)', () => {
    const source = readFileSync(join(__dirname, '../countries.ts'), 'utf8')
    expect(source).not.toMatch(/language-subtag-registry/)
    const generated = readFileSync(join(__dirname, '../countries.generated.ts'), 'utf8')
    expect(generated).toMatch(/AUTO-GENERATED/)
    expect(generated).toMatch(/code: "PL"/)
    expect(generated).toMatch(/code: "DE"/)

    expect(existsSync(DIST_COUNTRIES)).toBe(true)
    expect(existsSync(DIST_GENERATED)).toBe(true)
    const distCountries = readFileSync(DIST_COUNTRIES, 'utf8')
    const distGenerated = readFileSync(DIST_GENERATED, 'utf8')
    expect(distCountries).not.toMatch(/language-subtag-registry/)
    expect(distGenerated).not.toMatch(/language-subtag-registry/)
    expect(distCountries).toMatch(/from "\.\/countries\.generated\.js"/)
    expect(distGenerated).toMatch(/code: "PL"/)
    expect(distGenerated).toMatch(/code: "DE"/)
  })

  it('includes Kosovo, which the language-subtag registry does not list', () => {
    const kosovo = ISO_COUNTRIES.filter((entry) => entry.code === 'XK')
    expect(kosovo).toEqual([{ code: 'XK', name: 'Kosovo' }])
  })

  it('does not duplicate any country code', () => {
    const codes = ISO_COUNTRIES.map((entry) => entry.code)
    expect(codes).toHaveLength(new Set(codes).size)
  })

  it('keeps registry-derived countries intact', () => {
    expect(ISO_COUNTRIES).toEqual(
      expect.arrayContaining([
        { code: 'PL', name: 'Poland' },
        { code: 'DE', name: 'Germany' },
      ])
    )
  })

  it('stays sorted by name', () => {
    const names = ISO_COUNTRIES.map((entry) => entry.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    expect(names).toEqual(sorted)
  })
})

describe('resolveCountryName', () => {
  it('resolves Kosovo for XK', () => {
    expect(resolveCountryName('XK')).toBe('Kosovo')
  })

  it('resolves Kosovo for a lowercase xk', () => {
    expect(resolveCountryName('xk')).toBe('Kosovo')
  })

  it('still resolves registry-backed countries', () => {
    expect(resolveCountryName('PL')).toBe('Poland')
  })

  it('falls back to the raw code for an unknown region', () => {
    expect(resolveCountryName('ZZZ')).toBe('ZZZ')
  })
})

describe('buildCountryOptions', () => {
  it('offers Kosovo as a selectable option', () => {
    const options = buildCountryOptions()
    expect(options).toEqual(expect.arrayContaining([{ code: 'XK', label: 'Kosovo' }]))
  })

  it('offers exactly one Kosovo option', () => {
    const options = buildCountryOptions().filter((option) => option.code === 'XK')
    expect(options).toHaveLength(1)
  })

  it('lists Kosovo after the prioritized countries', () => {
    const options = buildCountryOptions()
    const kosovoIndex = options.findIndex((option) => option.code === 'XK')
    expect(kosovoIndex).toBeGreaterThanOrEqual(COUNTRY_PRIORITY.length)
  })

  it('keeps the prioritized countries at the top', () => {
    const options = buildCountryOptions()
    const leading = options.slice(0, COUNTRY_PRIORITY.length).map((option) => option.code)
    expect(leading.slice().sort()).toEqual(COUNTRY_PRIORITY.slice().sort())
  })

  it('applies transformLabel to the supplemental country too', () => {
    const options = buildCountryOptions({
      transformLabel: (code, defaultLabel) => `${defaultLabel} (${code})`,
    })
    expect(options).toEqual(expect.arrayContaining([{ code: 'XK', label: 'Kosovo (XK)' }]))
  })
})

describe('matchCountryCodes', () => {
  it('maps English country names to ISO codes so list search can find stored PL rows', () => {
    expect(matchCountryCodes('Poland')).toContain('PL')
  })

  it('maps localized names when extra locales are provided', () => {
    expect(matchCountryCodes('Polska', { locales: ['pl'] })).toContain('PL')
  })

  it('returns nothing for blank search terms', () => {
    expect(matchCountryCodes('   ')).toEqual([])
  })
})
