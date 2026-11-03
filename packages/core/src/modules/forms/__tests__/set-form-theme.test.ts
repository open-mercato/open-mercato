import {
  setFormTheme,
  setFormThemeField,
  SchemaHelperError,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'
import type { OmTheme } from '../schema/style-extensions'
import { contrastRatio, meetsAA } from '../backend/forms/[id]/studio/style/contrast'

function baseSchema(): FormSchema {
  return { type: 'object', properties: {} }
}

describe('setFormTheme', () => {
  it('writes a valid theme onto x-om-theme', () => {
    const theme: OmTheme = { accent: '#0f766e', radius: 'lg', fontFamily: 'sans' }
    const result = setFormTheme(baseSchema(), theme)
    expect(result['x-om-theme']).toEqual(theme)
  })

  it('does not alias into the input schema (deep clone)', () => {
    const input = baseSchema()
    const result = setFormTheme(input, { accent: '#123456' })
    expect(input['x-om-theme']).toBeUndefined()
    expect(result).not.toBe(input)
  })

  it('clears x-om-theme when given undefined', () => {
    const withTheme = setFormTheme(baseSchema(), { accent: '#0f766e' })
    expect(withTheme['x-om-theme']).toBeDefined()
    const cleared = setFormTheme(withTheme, undefined)
    expect(cleared['x-om-theme']).toBeUndefined()
  })

  it('clears x-om-theme when given an empty object', () => {
    const withTheme = setFormTheme(baseSchema(), { accent: '#0f766e' })
    const cleared = setFormTheme(withTheme, {})
    expect(cleared['x-om-theme']).toBeUndefined()
  })

  it('accepts a curated token color', () => {
    const result = setFormTheme(baseSchema(), { surface: 'surface', foreground: 'foreground' })
    expect(result['x-om-theme']).toEqual({ surface: 'surface', foreground: 'foreground' })
  })

  it('accepts a gradient background', () => {
    const theme: OmTheme = {
      background: { kind: 'gradient', from: '#0f766e', to: '#115e59', angle: 135 },
    }
    expect(setFormTheme(baseSchema(), theme)['x-om-theme']).toEqual(theme)
  })

  it('rejects a non-hex / functional color (R-CS-1)', () => {
    expect(() =>
      setFormTheme(baseSchema(), { accent: 'rgb(255,0,0)' as never }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects an out-of-range gradient angle', () => {
    expect(() =>
      setFormTheme(baseSchema(), {
        background: { kind: 'gradient', from: '#fff', to: '#000', angle: 999 },
      }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects an unknown theme key', () => {
    expect(() =>
      setFormTheme(baseSchema(), { evil: 'x' } as never),
    ).toThrow(SchemaHelperError)
  })
})

describe('setFormThemeField', () => {
  it('sets a single member, merging with the existing theme', () => {
    const withAccent = setFormTheme(baseSchema(), { accent: '#0f766e' })
    const next = setFormThemeField(withAccent, 'radius', 'lg')
    expect(next['x-om-theme']).toEqual({ accent: '#0f766e', radius: 'lg' })
  })

  it('removes a single member when given undefined', () => {
    const withTwo = setFormTheme(baseSchema(), { accent: '#0f766e', radius: 'lg' })
    const next = setFormThemeField(withTwo, 'radius', undefined)
    expect(next['x-om-theme']).toEqual({ accent: '#0f766e' })
  })

  it('clears the whole key when the last member is removed', () => {
    const withOne = setFormTheme(baseSchema(), { radius: 'lg' })
    const next = setFormThemeField(withOne, 'radius', undefined)
    expect(next['x-om-theme']).toBeUndefined()
  })
})

describe('contrastRatio', () => {
  it('returns ~21 for black on white', () => {
    const ratio = contrastRatio('#000000', '#ffffff')
    expect(ratio).not.toBeNull()
    expect(ratio as number).toBeCloseTo(21, 0)
  })

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('expands 3-digit shorthand hex', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0)
  })

  it('returns null for a non-hex value', () => {
    expect(contrastRatio('surface', '#ffffff')).toBeNull()
  })

  it('meetsAA distinguishes pass/fail at 4.5', () => {
    expect(meetsAA(contrastRatio('#000000', '#ffffff') as number)).toBe(true)
    expect(meetsAA(contrastRatio('#777777', '#888888') as number)).toBe(false)
  })
})
