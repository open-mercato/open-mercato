import { DEFAULT_PRESET, NAMED_PRESETS, decodePreset, encodePreset, namedPresetId, shufflePreset, themePresetSchema } from '../theme-preset'

describe('theme presets', () => {
  it('round-trips a preset through the URL code', () => {
    const preset = { ...NAMED_PRESETS.ocean, secondary: '#112233' }
    const code = encodePreset(preset)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodePreset(code)).toEqual(preset)
  })

  it('accepts named presets and rejects broken or oversized codes', () => {
    expect(decodePreset('forest')).toEqual(NAMED_PRESETS.forest)
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
    expect(namedPresetId(NAMED_PRESETS.berry)).toBe('berry')
    expect(namedPresetId({ ...NAMED_PRESETS.berry, density: 'compact' })).toBeNull()
  })
})
