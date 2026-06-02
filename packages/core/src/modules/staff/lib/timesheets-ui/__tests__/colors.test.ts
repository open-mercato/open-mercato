import {
  PROJECT_COLORS,
  PROJECT_COLOR_KEYS,
  autoColorFromName,
  resolveProjectColorHex,
  isProjectColorKey,
} from '../colors'

describe('PROJECT_COLORS palette', () => {
  it('has exactly 12 entries', () => {
    expect(PROJECT_COLORS).toHaveLength(12)
  })

  it('all keys are unique', () => {
    const keys = PROJECT_COLORS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('all hex values are valid 7-char hex strings', () => {
    for (const color of PROJECT_COLORS) {
      expect(color.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('PROJECT_COLOR_KEYS matches palette keys', () => {
    expect(PROJECT_COLOR_KEYS).toEqual(PROJECT_COLORS.map((c) => c.key))
  })
})

describe('isProjectColorKey', () => {
  it('returns true for valid keys', () => {
    expect(isProjectColorKey('blue')).toBe(true)
    expect(isProjectColorKey('slate')).toBe(true)
  })

  it('returns false for invalid values', () => {
    expect(isProjectColorKey('magenta')).toBe(false)
    expect(isProjectColorKey('')).toBe(false)
    expect(isProjectColorKey(null)).toBe(false)
    expect(isProjectColorKey(42)).toBe(false)
  })
})

describe('autoColorFromName', () => {
  it('returns a stable color for the same input', () => {
    const a = autoColorFromName('Website Redesign')
    const b = autoColorFromName('Website Redesign')
    expect(a.key).toBe(b.key)
    expect(a.hex).toBe(b.hex)
  })

  it('returns a valid palette entry', () => {
    const result = autoColorFromName('Random Project')
    expect(PROJECT_COLOR_KEYS).toContain(result.key)
    expect(result.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('handles empty and null input', () => {
    const empty = autoColorFromName('')
    const nil = autoColorFromName(null)
    const undef = autoColorFromName(undefined)
    expect(empty.key).toBe(nil.key)
    expect(nil.key).toBe(undef.key)
  })

  it('is case-insensitive', () => {
    expect(autoColorFromName('ABC').key).toBe(autoColorFromName('abc').key)
  })
})

describe('resolveProjectColorHex', () => {
  it('returns explicit color hex when key is valid', () => {
    const hex = resolveProjectColorHex('blue', 'Whatever Name')
    expect(hex).toBe('#3B82F6')
  })

  it('falls back to auto-generated color when key is null', () => {
    const hex = resolveProjectColorHex(null, 'My Project')
    expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(hex).toBe(autoColorFromName('My Project').hex)
  })

  it('falls back to auto-generated color when key is invalid', () => {
    const hex = resolveProjectColorHex('not-a-color', 'Fallback')
    expect(hex).toBe(autoColorFromName('Fallback').hex)
  })
})
