import {
  belowAaForPair,
  contrastRatio,
  meetsAA,
  resolveColorToRgb,
} from '../backend/forms/[id]/studio/style/contrast'

describe('resolveColorToRgb — token-aware', () => {
  it('resolves curated tokens to their light-mode sRGB', () => {
    expect(resolveColorToRgb('surface')).toEqual({ r: 255, g: 255, b: 255 })
    expect(resolveColorToRgb('foreground')).toEqual({ r: 10, g: 10, b: 10 })
    expect(resolveColorToRgb('muted-foreground')).toEqual({ r: 115, g: 115, b: 115 })
  })

  it('resolves hex literals', () => {
    expect(resolveColorToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(resolveColorToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('returns null for colorless tokens / malformed / absent', () => {
    expect(resolveColorToRgb('transparent')).toBeNull()
    expect(resolveColorToRgb('inherit')).toBeNull()
    expect(resolveColorToRgb(undefined)).toBeNull()
    expect(resolveColorToRgb('rgb(0,0,0)' as never)).toBeNull()
  })
})

describe('belowAaForPair — broadened AA check', () => {
  it('flags a low-contrast CUSTOM hex against a TOKEN surface (the branded case)', () => {
    // very light grey text on the default white surface — fails AA
    expect(belowAaForPair('#dddddd', 'surface')).not.toBeNull()
  })

  it('passes a high-contrast custom hex against a token surface', () => {
    expect(belowAaForPair('#000000', 'surface')).toBeNull()
  })

  it('skips token-vs-token pairs (DS-curated, no false positives)', () => {
    expect(belowAaForPair('foreground', 'surface')).toBeNull()
    expect(belowAaForPair('muted-foreground', 'surface-muted')).toBeNull()
  })

  it('skips when a side is not comparable (transparent / absent)', () => {
    expect(belowAaForPair('#dddddd', 'transparent')).toBeNull()
    expect(belowAaForPair('#dddddd', undefined)).toBeNull()
  })

  it('still catches the original hex-vs-hex low-contrast case', () => {
    expect(belowAaForPair('#ffffff', '#eeeeee')).not.toBeNull()
  })
})

describe('contrastRatio / meetsAA (unchanged primitives)', () => {
  it('black on white is the maximal ratio and meets AA', () => {
    const ratio = contrastRatio('#000000', '#ffffff')
    expect(ratio).not.toBeNull()
    expect(meetsAA(ratio as number)).toBe(true)
  })
})
