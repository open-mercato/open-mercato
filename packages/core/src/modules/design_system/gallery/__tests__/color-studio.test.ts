import { contrastRatio } from '../components/colorPreview'
import { createColorStudio, createHarmonySeeds, exportColorStudio, type Harmony, type NeutralTone, type Shade } from '../components/colorStudio'

const SHADES: Shade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const SEEDS = ['#000000', '#FFFFFF', '#F4700D', '#0000FF', '#00FF00', '#FF00FF', '#FFFF00', '#777777', '#010101', '#FEFEFE']

function perceptualLightness(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2104542553 * Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
    + 0.793617785 * Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
    - 0.0040720468 * Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
}

describe('designer palette scale', () => {
  it.each(SEEDS)('preserves %s and returns eleven descending in-gamut shades', (seed) => {
    const { scale } = createColorStudio(seed, 'neutral')
    expect(scale.map((stop) => stop.step)).toEqual(SHADES)
    expect(scale.filter((stop) => stop.hex === seed)).toHaveLength(1)
    scale.forEach((stop, index) => {
      expect(stop.hex).toMatch(/^#[0-9A-F]{6}$/)
      if (index > 0) expect(perceptualLightness(stop.hex)).toBeLessThan(perceptualLightness(scale[index - 1].hex))
    })
  })

  it('anchors white and black at the ends instead of disrupting the middle of the scale', () => {
    expect(createColorStudio('#FFFFFF', 'neutral').scale[0]).toEqual({ step: 50, hex: '#FFFFFF' })
    expect(createColorStudio('#000000', 'neutral').scale[10]).toEqual({ step: 950, hex: '#000000' })
  })

  it('keeps vivid out-of-gamut candidates near their requested lightness after chroma reduction', () => {
    const { scale } = createColorStudio('#0000FF', 'neutral')
    expect(perceptualLightness(scale[1].hex)).toBeCloseTo(0.95, 2)
    expect(perceptualLightness(scale[4].hex)).toBeCloseTo(0.74, 2)
    expect(perceptualLightness(scale[9].hex)).toBeCloseTo(0.26, 2)
    expect(scale[1].hex).not.toBe('#FFFFFF')
  })

  it('normalizes input and uses a deterministic fallback', () => {
    expect(createColorStudio(' abc ', 'cool')).toEqual(createColorStudio('#AABBCC', 'cool'))
    expect(createColorStudio('invalid', 'warm')).toEqual(createColorStudio('#F4700D', 'warm'))
  })

  it.each<NeutralTone>(['neutral', 'warm', 'cool'])('builds a descending %s neutral scale independent of the accent', (neutral) => {
    const studio = createColorStudio('#F4700D', neutral)
    expect(studio.neutralScale).toEqual(createColorStudio('#2563EB', neutral).neutralScale)
    expect(studio.neutralScale.map((stop) => stop.step)).toEqual(SHADES)
    studio.neutralScale.forEach((stop, index) => {
      if (index > 0) expect(perceptualLightness(stop.hex)).toBeLessThan(perceptualLightness(studio.neutralScale[index - 1].hex))
    })
  })

  it('distinguishes warm and cool neutrals while preserving achromatic neutral', () => {
    const warm = createColorStudio('#F4700D', 'warm').neutralScale[5].hex
    const cool = createColorStudio('#F4700D', 'cool').neutralScale[5].hex
    const neutral = createColorStudio('#F4700D', 'neutral').neutralScale[5].hex
    expect(Number.parseInt(warm.slice(1, 3), 16)).toBeGreaterThan(Number.parseInt(warm.slice(5, 7), 16))
    expect(Number.parseInt(cool.slice(1, 3), 16)).toBeLessThan(Number.parseInt(cool.slice(5, 7), 16))
    expect(neutral.slice(1, 3)).toBe(neutral.slice(3, 5))
    expect(neutral.slice(3, 5)).toBe(neutral.slice(5, 7))
  })
})

describe.each<NeutralTone>(['neutral', 'warm', 'cool'])('theme roles with %s neutrals', (neutral) => {
  it.each(SEEDS)('measures actual readable pairs for %s without overriding statuses', (seed) => {
    const studio = createColorStudio(seed, neutral)
    for (const theme of [studio.light, studio.dark]) {
      expect(Object.keys(theme.tokens).some((key) => key.includes('status'))).toBe(false)
      expect(theme.pairs.map((pair) => pair.id)).toEqual(['action', 'hover', 'body', 'muted', 'selection', 'focus'])
      for (const pair of theme.pairs) {
        expect(pair.ratio).toBe(contrastRatio(pair.foreground, pair.background))
        expect(pair.ratio).toBeGreaterThanOrEqual(pair.minimum)
      }
      expect(theme.pairs[0].background).toBe(theme.tokens['--primary'])
      expect(theme.pairs[1].background).toBe(theme.tokens['--primary-hover'])
      expect(theme.pairs[4].background).toBe(theme.tokens['--accent'])
      expect(theme.pairs[4].foreground).toBe(theme.tokens['--accent-foreground'])
      expect(theme.pairs[5].foreground).toBe(theme.tokens['--focus-ring-outer'])
      expect(contrastRatio(theme.tokens['--accent'], theme.tokens['--accent-foreground'])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(theme.tokens['--accent-indigo'], theme.tokens['--input'])).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(theme.tokens['--accent-indigo'], theme.tokens['--accent-indigo-foreground'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(SHADES)('maps the selected action shade %s exactly and adapts foreground separately', (shade) => {
    const studio = createColorStudio('#F4700D', neutral, { light: shade, dark: shade })
    const selected = studio.scale.find((stop) => stop.step === shade)!.hex
    for (const theme of [studio.light, studio.dark]) {
      expect(theme.actionStep).toBe(shade)
      expect(theme.tokens['--primary']).toBe(selected)
      expect(theme.pairs[0].ratio).toBeGreaterThanOrEqual(4.5)
      expect(theme.pairs[1].ratio).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('designer palette exports', () => {
  it('exports the exact displayed token values and both scales as JSON', () => {
    const studio = createColorStudio('#F4700D', 'warm', { light: 700, dark: 300 })
    const exported = JSON.parse(exportColorStudio(studio, 'json'))
    expect(exported.seeds).toEqual(studio.seeds)
    expect(exported.scales.secondary).toEqual(Object.fromEntries(studio.secondaryScale.map((stop) => [stop.step, stop.hex])))
    expect(exported.scales.tertiary).toEqual(Object.fromEntries(studio.tertiaryScale.map((stop) => [stop.step, stop.hex])))
    expect(exported.themes).toEqual({ light: studio.light.tokens, dark: studio.dark.tokens })
    expect(exported.scales.accent).toEqual(Object.fromEntries(studio.scale.map((stop) => [stop.step, stop.hex])))
    expect(exported.scales.neutral).toEqual(Object.fromEntries(studio.neutralScale.map((stop) => [stop.step, stop.hex])))
  })

  it('exports scoped CSS without mutating or targeting the app theme', () => {
    const studio = createColorStudio('#F4700D', 'cool')
    const before = JSON.stringify(studio)
    const css = exportColorStudio(studio, 'css')
    expect(css).not.toContain(':root')
    expect(css).not.toContain('--status-')
    for (const theme of ['light', 'dark'] as const) {
      expect(css).toContain(`.ds-color-preview-${theme} {`)
      for (const [token, value] of Object.entries(studio[theme].tokens)) expect(css).toContain(`${token}: ${value};`)
      for (const stop of studio.scale) expect(css).toContain(`--palette-accent-${stop.step}: ${stop.hex};`)
      for (const stop of studio.secondaryScale) expect(css).toContain(`--palette-secondary-${stop.step}: ${stop.hex};`)
      for (const stop of studio.tertiaryScale) expect(css).toContain(`--palette-tertiary-${stop.step}: ${stop.hex};`)
      for (const stop of studio.neutralScale) expect(css).toContain(`--palette-neutral-${stop.step}: ${stop.hex};`)
    }
    expect(JSON.stringify(studio)).toBe(before)
  })
})


describe.each<Harmony>(['analogous', 'triadic', 'split'])('%s harmony', (harmony) => {
  it.each(SEEDS)('derives usable secondary and tertiary scales for %s', (seed) => {
    const derived = createHarmonySeeds(seed, harmony)
    const studio = createColorStudio(seed, 'neutral', {}, { harmony })
    expect(studio.seeds).toEqual({ primary: seed, ...derived })
    expect(derived.secondary).not.toBe(derived.tertiary)
    for (const [name, scale] of [['secondary', studio.secondaryScale], ['tertiary', studio.tertiaryScale]] as const) {
      expect(scale.map((stop) => stop.step)).toEqual(SHADES)
      expect(scale.some((stop) => stop.hex === derived[name])).toBe(true)
      expect(perceptualLightness(derived[name])).toBeGreaterThan(0.545)
      expect(perceptualLightness(derived[name])).toBeLessThan(0.725)
      scale.forEach((stop, index) => {
        expect(stop.hex).toMatch(/^#[0-9A-F]{6}$/)
        if (index > 0) expect(perceptualLightness(stop.hex)).toBeLessThan(perceptualLightness(scale[index - 1].hex))
      })
      for (const theme of [studio.light, studio.dark]) {
        expect(contrastRatio(theme.tokens[`--studio-${name}`], theme.tokens[`--studio-${name}-foreground`])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(theme.tokens[`--studio-${name}-soft`], theme.tokens[`--studio-${name}-soft-foreground`])).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

it('keeps harmony modes distinct and deterministic', () => {
  const modes = (['analogous', 'triadic', 'split'] as const).map((mode) => createHarmonySeeds('#F4700D', mode))
  expect(new Set(modes.map((mode) => mode.secondary)).size).toBe(3)
  expect(new Set(modes.map((mode) => mode.tertiary)).size).toBe(3)
  expect(createColorStudio('#F4700D', 'neutral').seeds).toEqual({ primary: '#F4700D', ...modes[1] })
})

it('preserves independent manual seeds without changing the primary scale or neutrals', () => {
  const original = createColorStudio('#F4700D', 'warm')
  const manual = createColorStudio('#F4700D', 'warm', {}, { secondary: '#abc', tertiary: '#000000', harmony: 'split' })
  expect(manual.seeds).toEqual({ primary: '#F4700D', secondary: '#AABBCC', tertiary: '#000000' })
  expect(manual.secondaryScale.some((stop) => stop.hex === '#AABBCC')).toBe(true)
  expect(manual.tertiaryScale[10].hex).toBe('#000000')
  expect(manual.scale).toEqual(original.scale)
  expect(manual.neutralScale).toEqual(original.neutralScale)
})

it('falls back independently for invalid manual seeds', () => {
  const studio = createColorStudio('#F4700D', 'cool', {}, { secondary: 'invalid', tertiary: '#123456', harmony: 'analogous' })
  expect(studio.seeds.secondary).toBe(createHarmonySeeds('#F4700D', 'analogous').secondary)
  expect(studio.seeds.tertiary).toBe('#123456')
})


describe.each<NeutralTone>(['neutral', 'warm', 'cool'])('quiet dark surfaces with %s neutrals', (neutral) => {
  it.each(SEEDS)('tints neutral surfaces subtly for %s while preserving readable labels', (seed) => {
    for (const actionStep of SHADES) {
      const studio = createColorStudio(seed, neutral, { dark: actionStep })
      const dark = studio.dark.tokens
      for (const [surface, foreground] of [
        ['--accent', '--accent-foreground'],
        ['--studio-secondary-soft', '--studio-secondary-soft-foreground'],
        ['--studio-tertiary-soft', '--studio-tertiary-soft-foreground'],
      ]) {
        expect(contrastRatio(dark[surface], dark['--card'])).toBeLessThan(1.6)
        expect(contrastRatio(dark[surface], dark[foreground])).toBeGreaterThanOrEqual(4.5)
      }
      expect(studio.light.tokens['--accent']).toBe(studio.scale.find((stop) => stop.step === 100)!.hex)
      expect(studio.light.tokens['--studio-secondary-soft']).toBe(studio.secondaryScale.find((stop) => stop.step === 100)!.hex)
      expect(studio.light.tokens['--studio-tertiary-soft']).toBe(studio.tertiaryScale.find((stop) => stop.step === 100)!.hex)
    }
  })
})
