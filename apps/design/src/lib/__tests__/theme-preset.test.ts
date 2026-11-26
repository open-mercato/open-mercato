import { createColorStudio, createHarmonySeeds, isBrownHue } from '@open-mercato/core/modules/design_system/gallery/components/colorStudio'
import { DEFAULT_PRESET, NAMED_PRESETS, decodePreset, encodePreset, namedPresetId, shufflePreset, themePresetSchema } from '../theme-preset'

describe('theme presets', () => {
  it('round-trips a preset through the URL code', () => {
    const preset = { ...NAMED_PRESETS.ocean, secondary: '#112233' }
    const code = encodePreset(preset)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodePreset(code)).toEqual(preset)
  })

  it('accepts named presets and rejects broken or oversized codes', () => {
    expect(decodePreset('sage')).toEqual(NAMED_PRESETS.sage)
    expect(decodePreset('not-a-preset')).toBeNull()
    expect(decodePreset('x'.repeat(500))).toBeNull()
    expect(decodePreset(null)).toBeNull()
    expect(decodePreset(encodePreset(DEFAULT_PRESET).slice(0, 10))).toBeNull()
  })

  it('shuffles into a valid preset', () => {
    let seed = 0.13
    const random = () => {
      seed = (seed * 9301 + 0.49297) % 1
      return seed
    }
    for (let index = 0; index < 20; index += 1) {
      expect(themePresetSchema.safeParse(shufflePreset(random)).success).toBe(true)
    }
  })

  it('recognises a named preset', () => {
    expect(namedPresetId(NAMED_PRESETS.mauve)).toBe('mauve')
    expect(namedPresetId({ ...NAMED_PRESETS.mauve, density: 'compact' })).toBeNull()
  })

  it('keeps every named preset readable in both modes', () => {
    const failures: string[] = []
    for (const [id, preset] of Object.entries(NAMED_PRESETS)) {
      const studio = createColorStudio(preset.primary, preset.neutral, { light: preset.light, dark: preset.dark }, { harmony: preset.harmony, secondary: preset.secondary, tertiary: preset.tertiary })
      for (const mode of ['light', 'dark'] as const) {
        for (const pair of studio[mode].pairs) {
          if (pair.ratio < pair.minimum) failures.push(`${id} ${mode} ${pair.id} ${pair.ratio.toFixed(2)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps brown-leaning hues out of every named preset and its derived colours', () => {
    const offenders: string[] = []
    for (const [id, preset] of Object.entries(NAMED_PRESETS)) {
      const studio = createColorStudio(preset.primary, preset.neutral, { light: preset.light, dark: preset.dark }, { harmony: preset.harmony, secondary: preset.secondary, tertiary: preset.tertiary })
      for (const [role, color] of Object.entries(studio.seeds)) {
        if (isBrownHue(color)) offenders.push(`${id} ${role} ${color}`)
      }
      if (preset.neutral === 'warm') offenders.push(`${id} warm neutral`)
    }
    expect(offenders).toEqual([])
  })

  it('never shuffles into a brown-leaning primary, derived colour or warm neutral', () => {
    let seed = 0.37
    const random = () => {
      seed = (seed * 9301 + 0.49297) % 1
      return seed
    }
    for (let index = 0; index < 500; index += 1) {
      const preset = shufflePreset(random)
      const derived = createHarmonySeeds(preset.primary, preset.harmony)
      expect([preset.primary, derived.secondary, derived.tertiary].filter(isBrownHue)).toEqual([])
      expect(preset.neutral).not.toBe('warm')
    }
  })

  it('steers derived harmony colours away from brown for any primary', () => {
    const offenders: string[] = []
    for (const primary of ['#2563EB', '#0891B2', '#15803D', '#C026D3', '#F4700D', '#B7791F', '#DC2626', '#EAB308']) {
      for (const harmony of ['analogous', 'triadic', 'split'] as const) {
        const derived = createHarmonySeeds(primary, harmony)
        if (isBrownHue(derived.secondary) || isBrownHue(derived.tertiary)) offenders.push(`${primary} ${harmony}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
