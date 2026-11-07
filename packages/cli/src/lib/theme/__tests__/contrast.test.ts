import {
  contrastRatio,
  formatContrastRatio,
  formatHexColor,
  parseHexColor,
  relativeLuminance,
  WCAG_AA_TEXT,
  WCAG_AA_UI,
} from '../contrast'

describe('parseHexColor', () => {
  it('parses #RRGGBB', () => {
    expect(parseHexColor('#0C71C6')).toEqual({ r: 12, g: 113, b: 198 })
  })

  it('parses #RGB shorthand by channel doubling', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('#1a2')).toEqual({ r: 17, g: 170, b: 34 })
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(parseHexColor('  #ABCdef ')).toEqual({ r: 171, g: 205, b: 239 })
  })

  it('rejects invalid input', () => {
    expect(parseHexColor('0C71C6')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
    expect(parseHexColor('#1234567')).toBeNull()
    expect(parseHexColor('rebeccapurple')).toBeNull()
    expect(parseHexColor('#GGGGGG')).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })
})

describe('formatHexColor', () => {
  it('round-trips and lowercases', () => {
    expect(formatHexColor(parseHexColor('#0C71C6')!)).toBe('#0c71c6')
  })

  it('clamps out-of-range channels', () => {
    expect(formatHexColor({ r: -5, g: 300, b: 127.6 })).toBe('#00ff80')
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10)
  })

  it('applies the 0.03928 channel knee (WCAG 2.1 normative)', () => {
    // 10/255 ≈ 0.0392 < 0.03928 → linear branch: c / 12.92
    const below = relativeLuminance({ r: 10, g: 0, b: 0 })
    expect(below).toBeCloseTo(0.2126 * (10 / 255 / 12.92), 10)
    // 11/255 ≈ 0.0431 > 0.03928 → gamma branch
    const above = relativeLuminance({ r: 11, g: 0, b: 0 })
    expect(above).toBeCloseTo(0.2126 * Math.pow((11 / 255 + 0.055) / 1.055, 2.4), 10)
  })
})

describe('contrastRatio', () => {
  const white = parseHexColor('#ffffff')!
  const black = parseHexColor('#000000')!

  it('is 21:1 for black on white', () => {
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5)
  })

  it('is 1:1 for identical colors', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 10)
  })

  it('matches the WCAG reference pair #767676 on #ffffff (~4.54:1)', () => {
    const gray = parseHexColor('#767676')!
    const ratio = contrastRatio(white, gray)
    expect(ratio).toBeGreaterThan(4.5)
    expect(ratio).toBeCloseTo(4.54, 2)
  })

  it('is symmetric', () => {
    const a = parseHexColor('#0C71C6')!
    const b = parseHexColor('#f3f4f6')!
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12)
  })

  it('classifies against the AA thresholds', () => {
    const gray = parseHexColor('#767676')!
    const lightGray = parseHexColor('#aaaaaa')!
    expect(contrastRatio(white, gray)).toBeGreaterThanOrEqual(WCAG_AA_TEXT)
    expect(contrastRatio(white, lightGray)).toBeLessThan(WCAG_AA_TEXT)
    expect(contrastRatio(white, lightGray)).toBeLessThan(WCAG_AA_UI)
  })
})

describe('formatContrastRatio', () => {
  it('formats with at most one decimal, flooring so the display never contradicts the verdict', () => {
    expect(formatContrastRatio(21.000001)).toBe('21:1')
    expect(formatContrastRatio(4.54)).toBe('4.5:1')
    expect(formatContrastRatio(1.94)).toBe('1.9:1')
    expect(formatContrastRatio(12.096)).toBe('12:1')
    expect(formatContrastRatio(3)).toBe('3:1')
    expect(formatContrastRatio(4.478)).toBe('4.4:1')
    expect(formatContrastRatio(4.499)).toBe('4.4:1')
  })
})
