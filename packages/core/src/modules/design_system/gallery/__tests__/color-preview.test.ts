import { contrastRatio, createAccentPalette, normalizeHex } from '../components/colorPreview'

describe('color preview input', () => {
  it.each([
    ['#abc', '#AABBCC'],
    [' f4700d ', '#F4700D'],
    ['#Ff00aA', '#FF00AA'],
    ['000', '#000000'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected)
  })

  it.each(['', '#', '#ff', '#abcd', '#12345678', 'red', '#GGGGGG', 'rgb(0,0,0)', '##123456'])('rejects %s', (input) => {
    expect(normalizeHex(input)).toBeNull()
  })
})

describe('color preview contrast', () => {
  it('matches reference sRGB contrast ratios without rounding near the 4.5 threshold', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.478, 3)
    expect(contrastRatio('#FFFFFF', '#777777')).toBeCloseTo(4.478, 3)
    expect(contrastRatio('#123456', '#123456')).toBe(1)
  })

  it('does not report passing contrast for invalid input', () => {
    expect(contrastRatio('invalid', '#FFFFFF')).toBe(1)
  })
})

describe.each(['#FFFFFF', '#171717'])('accent preview on %s', (surface) => {
  it.each(['#000000', '#FFFFFF', '#F4700D', '#777777', '#00FF00', '#0000FF', '#FF00FF', '#FFFF00'])('keeps readable text in every state for %s', (input) => {
    const palette = createAccentPalette(input, surface)
    expect(palette.color).toBe(input)
    expect(contrastRatio(palette.color, palette.foreground)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.hover, palette.foreground)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.soft, palette.softForeground)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.soft, surface)).toBeLessThan(1.4)
    for (const value of Object.values(palette)) expect(value).toMatch(/^#[\dA-F]{6}$/)
  })
})

it('uses a valid, readable fallback for malformed preview input', () => {
  expect(createAccentPalette('invalid', 'invalid')).toEqual(createAccentPalette('#000000', '#FFFFFF'))
})
