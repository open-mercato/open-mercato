import {
  COUNTRY_PRIORITY,
  ISO_COUNTRIES,
  buildCountryOptions,
  resolveCountryName,
} from '../countries'

describe('ISO_COUNTRIES', () => {
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
