import { contrastRatio, parseHexColor } from '../contrast'
import {
  derivePalette,
  hexToOklch,
  oklchToHex,
  PROTECTED_TOKEN_PATTERNS,
  renderThemeCss,
  validateRadius,
} from '../palette'

/** Representative primaries per the spec's validation plan. */
const REPRESENTATIVE_PRIMARIES = {
  darkBrand: '#0C71C6', // dark-ish brand blue
  lightPastel: '#8FC1E9', // light pastel — must pick a dark foreground
  midValley: '#767676', // mid-luminance valley — marginal for both candidates
  achromaticGray: '#555555', // achromatic gray — hue-free derivation
} as const

describe('hexToOklch / oklchToHex', () => {
  it('round-trips representative colors within 1 hex step per channel', () => {
    for (const hex of Object.values(REPRESENTATIVE_PRIMARIES)) {
      const oklch = hexToOklch(hex)!
      const roundTripped = parseHexColor(oklchToHex(oklch))!
      const original = parseHexColor(hex)!
      expect(Math.abs(roundTripped.r - original.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(roundTripped.g - original.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(roundTripped.b - original.b)).toBeLessThanOrEqual(1)
    }
  })

  it('matches known OKLCH reference points', () => {
    expect(hexToOklch('#ffffff')!.l).toBeCloseTo(1, 2)
    expect(hexToOklch('#000000')!.l).toBeCloseTo(0, 2)
    // Achromatic input has ~zero chroma
    expect(hexToOklch('#767676')!.c).toBeLessThan(0.001)
  })

  it('returns null for invalid hex', () => {
    expect(hexToOklch('not-a-color')).toBeNull()
  })

  it('gamut-maps out-of-sRGB colors instead of clipping channels', () => {
    // Very high chroma at high lightness is outside sRGB
    const hex = oklchToHex({ l: 0.9, c: 0.37, h: 145 })
    expect(parseHexColor(hex)).not.toBeNull()
    // Lightness is preserved by chroma reduction (within tolerance)
    expect(hexToOklch(hex)!.l).toBeCloseTo(0.9, 1)
  })
})

describe('derivePalette', () => {
  it('emits the input --primary as provided', () => {
    expect(derivePalette({ primaryHex: '#0C71C6' }).light.primary).toBe('#0C71C6')
  })

  it('derives a darker hover in light mode (lightness − 0.06, hue/chroma preserved)', () => {
    const palette = derivePalette({ primaryHex: REPRESENTATIVE_PRIMARIES.darkBrand })
    const primary = hexToOklch(palette.light.primary)!
    const hover = hexToOklch(palette.light.primaryHover)!
    expect(hover.l).toBeCloseTo(primary.l - 0.06, 2)
  })

  it('clamps hover lightness at 0.10', () => {
    const palette = derivePalette({ primaryHex: '#050505' })
    const hover = hexToOklch(palette.light.primaryHover)!
    // Hex round-trips lose a little precision at very low lightness
    expect(hover.l).toBeCloseTo(0.1, 1)
    expect(hover.l).toBeGreaterThan(hexToOklch('#050505')!.l - 0.06)
  })

  it('auto-picks white on a dark primary and near-black on a light pastel', () => {
    const dark = derivePalette({ primaryHex: REPRESENTATIVE_PRIMARIES.darkBrand })
    expect(dark.light.primaryForeground.hex).toBe('#ffffff')
    expect(dark.light.primaryForeground.autoPicked).toBe(true)

    const pastel = derivePalette({ primaryHex: REPRESENTATIVE_PRIMARIES.lightPastel })
    expect(pastel.light.primaryForeground.hex).toBe('#0a0a0a')
  })

  it('honors an explicit --primary-foreground and reports its true ratio', () => {
    const palette = derivePalette({
      primaryHex: REPRESENTATIVE_PRIMARIES.lightPastel,
      primaryForegroundHex: '#ffffff',
    })
    expect(palette.light.primaryForeground.hex).toBe('#ffffff')
    expect(palette.light.primaryForeground.autoPicked).toBe(false)
    const expected = contrastRatio(parseHexColor('#ffffff')!, parseHexColor(REPRESENTATIVE_PRIMARIES.lightPastel)!)
    expect(palette.light.primaryForeground.ratio).toBeCloseTo(expected, 10)
  })

  it('raises dark-mode primary lightness to at least 0.65', () => {
    for (const hex of Object.values(REPRESENTATIVE_PRIMARIES)) {
      const palette = derivePalette({ primaryHex: hex })
      expect(hexToOklch(palette.dark.primary)!.l).toBeGreaterThanOrEqual(0.64)
    }
  })

  it('keeps an already-light primary unchanged in dark mode', () => {
    const palette = derivePalette({ primaryHex: REPRESENTATIVE_PRIMARIES.lightPastel })
    const input = hexToOklch(REPRESENTATIVE_PRIMARIES.lightPastel)!
    expect(hexToOklch(palette.dark.primary)!.l).toBeCloseTo(input.l, 2)
  })

  it('re-picks the dark foreground independently against the dark primary', () => {
    // Dark primary is light (L >= 0.65) → foreground must be the dark candidate
    const palette = derivePalette({ primaryHex: REPRESENTATIVE_PRIMARIES.darkBrand })
    expect(palette.dark.primaryForeground.hex).toBe('#0a0a0a')
    expect(palette.dark.primaryForeground.autoPicked).toBe(true)
  })

  it('the mid-luminance valley color yields a marginal (sub-AA) auto-pick', () => {
    const palette = derivePalette({ primaryHex: REPRESENTATIVE_PRIMARIES.midValley })
    expect(palette.light.primaryForeground.ratio).toBeGreaterThanOrEqual(3)
    // #767676 sits near the valley floor: the winning candidate only just passes
    expect(palette.light.primaryForeground.ratio).toBeLessThan(5)
  })

  it('throws on an unparseable primary', () => {
    expect(() => derivePalette({ primaryHex: 'blue' })).toThrow(/Invalid primary color/)
  })
})

describe('renderThemeCss', () => {
  const render = (primaryHex: string, extra: { radius?: string; fontFamily?: string } = {}) =>
    renderThemeCss({
      palette: derivePalette({ primaryHex }),
      radius: extra.radius ?? null,
      fontFamily: extra.fontFamily ?? null,
    })

  it.each(Object.entries(REPRESENTATIVE_PRIMARIES))(
    'emits a stable theme for the %s primary',
    (_label, hex) => {
      expect(render(hex)).toMatchSnapshot()
    },
  )

  it('emits radius and font overrides with the system fallback stack', () => {
    expect(render('#0C71C6', { radius: '8px', fontFamily: 'Inter' })).toMatchSnapshot()
  })

  it('is deterministic — identical input yields byte-identical output', () => {
    expect(render('#0C71C6', { radius: '0.5rem' })).toBe(render('#0C71C6', { radius: '0.5rem' }))
  })

  it('structurally cannot emit protected-token declarations', () => {
    // The header comment names the protected tokens in prose; what matters is
    // that no protected token is ever *declared* (`--token:`).
    for (const hex of Object.values(REPRESENTATIVE_PRIMARIES)) {
      const css = render(hex, { radius: '8px', fontFamily: 'Inter' })
      const declared = [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1])
      for (const token of declared) {
        for (const pattern of PROTECTED_TOKEN_PATTERNS) {
          expect(token.startsWith(pattern)).toBe(false)
        }
      }
    }
  })

  it('only declares tokens from the safe identity surface', () => {
    const css = render('#0C71C6', { radius: '8px', fontFamily: 'Inter' })
    const declared = [...css.matchAll(/^\s*(--[a-z-]+):/gm)].map((match) => match[1])
    expect(new Set(declared)).toEqual(
      new Set(['--primary', '--primary-hover', '--primary-foreground', '--radius', '--font-geist-sans']),
    )
  })
})

describe('validateRadius', () => {
  it('accepts px/rem/em lengths', () => {
    expect(validateRadius('8px')).toEqual({ value: '8px', valid: true, warnings: [] })
    expect(validateRadius('0.5rem').valid).toBe(true)
    expect(validateRadius('0.5rem').warnings).toEqual([])
  })

  it('rejects non-length values', () => {
    expect(validateRadius('50%').valid).toBe(false)
    expect(validateRadius('round').valid).toBe(false)
  })

  it('warns below 0.25rem (radius-sm clamp) and above 1rem', () => {
    expect(validateRadius('2px').warnings).toHaveLength(1)
    expect(validateRadius('0.1rem').warnings).toHaveLength(1)
    expect(validateRadius('24px').warnings).toHaveLength(1)
    expect(validateRadius('0.625rem').warnings).toEqual([])
  })
})
