import { createColorStudio } from '@open-mercato/core/modules/design_system/gallery/components/colorStudio'
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
      const studio = createColorStudio(preset.primary, preset.neutral, { light: preset.light, dark: preset.dark }, { harmony: preset.harmony })
      for (const mode of ['light', 'dark'] as const) {
        for (const pair of studio[mode].pairs) {
          if (pair.ratio < pair.minimum) failures.push(`${id} ${mode} ${pair.id} ${pair.ratio.toFixed(2)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})
