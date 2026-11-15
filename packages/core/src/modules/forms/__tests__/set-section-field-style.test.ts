import {
  setSectionStyle,
  setFieldStyle,
  SchemaHelperError,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'
import type { OmFieldStyle, OmSectionStyle } from '../schema/style-extensions'

function baseSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-sections': [
      { key: 'intro', title: { en: 'Intro' }, fieldKeys: ['name'] },
    ],
    properties: {
      name: { type: 'string', 'x-om-type': 'text' },
    },
  }
}

function findSection(schema: FormSchema, key: string) {
  return (schema['x-om-sections'] ?? []).find((entry) => entry.key === key)
}

describe('setSectionStyle', () => {
  it('writes a valid style onto the section', () => {
    const style: OmSectionStyle = { padding: 'lg', card: true, align: 'center' }
    const result = setSectionStyle(baseSchema(), 'intro', style)
    expect(findSection(result, 'intro')?.style).toEqual(style)
  })

  it('does not alias into the input schema (deep clone)', () => {
    const input = baseSchema()
    const result = setSectionStyle(input, 'intro', { padding: 'sm' })
    expect(findSection(input, 'intro')?.style).toBeUndefined()
    expect(result).not.toBe(input)
  })

  it('accepts a gradient background and hex foreground', () => {
    const style: OmSectionStyle = {
      background: { kind: 'gradient', from: '#0f766e', to: '#115e59', angle: 135 },
      foreground: '#ffffff',
    }
    expect(findSection(setSectionStyle(baseSchema(), 'intro', style), 'intro')?.style).toEqual(style)
  })

  it('clears the style member when given undefined', () => {
    const styled = setSectionStyle(baseSchema(), 'intro', { padding: 'lg' })
    expect(findSection(styled, 'intro')?.style).toBeDefined()
    const cleared = setSectionStyle(styled, 'intro', undefined)
    expect(findSection(cleared, 'intro')?.style).toBeUndefined()
  })

  it('clears the style member when given an empty object', () => {
    const styled = setSectionStyle(baseSchema(), 'intro', { padding: 'lg' })
    const cleared = setSectionStyle(styled, 'intro', {})
    expect(findSection(cleared, 'intro')?.style).toBeUndefined()
  })

  it('rejects an invalid enum member (R-CS-1)', () => {
    expect(() =>
      setSectionStyle(baseSchema(), 'intro', { padding: 'huge' as never }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects a non-hex / functional color', () => {
    expect(() =>
      setSectionStyle(baseSchema(), 'intro', { foreground: 'rgb(0,0,0)' as never }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects an unknown style key', () => {
    expect(() =>
      setSectionStyle(baseSchema(), 'intro', { evil: 'x' } as never),
    ).toThrow(SchemaHelperError)
  })

  it('throws for an unknown section key', () => {
    expect(() =>
      setSectionStyle(baseSchema(), 'missing', { padding: 'sm' }),
    ).toThrow(SchemaHelperError)
  })
})

describe('setFieldStyle', () => {
  it('writes a valid style onto x-om-style', () => {
    const style: OmFieldStyle = { labelWeight: 'bold', accent: '#0f766e', align: 'end' }
    const result = setFieldStyle(baseSchema(), 'name', style)
    expect(result.properties.name['x-om-style']).toEqual(style)
  })

  it('does not alias into the input schema (deep clone)', () => {
    const input = baseSchema()
    const result = setFieldStyle(input, 'name', { accent: '#123456' })
    expect(input.properties.name['x-om-style']).toBeUndefined()
    expect(result).not.toBe(input)
  })

  it('accepts curated token colors', () => {
    const style: OmFieldStyle = { labelColor: 'muted-foreground', textColor: 'foreground' }
    expect(setFieldStyle(baseSchema(), 'name', style).properties.name['x-om-style']).toEqual(style)
  })

  it('clears x-om-style when given undefined', () => {
    const styled = setFieldStyle(baseSchema(), 'name', { labelWeight: 'medium' })
    expect(styled.properties.name['x-om-style']).toBeDefined()
    const cleared = setFieldStyle(styled, 'name', undefined)
    expect(cleared.properties.name['x-om-style']).toBeUndefined()
  })

  it('clears x-om-style when given an empty object', () => {
    const styled = setFieldStyle(baseSchema(), 'name', { labelWeight: 'medium' })
    const cleared = setFieldStyle(styled, 'name', {})
    expect(cleared.properties.name['x-om-style']).toBeUndefined()
  })

  it('rejects an invalid label weight', () => {
    expect(() =>
      setFieldStyle(baseSchema(), 'name', { labelWeight: 'heavy' as never }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects a non-hex / functional color', () => {
    expect(() =>
      setFieldStyle(baseSchema(), 'name', { accent: 'hsl(0,0%,0%)' as never }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects an unknown style key', () => {
    expect(() =>
      setFieldStyle(baseSchema(), 'name', { evil: 'x' } as never),
    ).toThrow(SchemaHelperError)
  })

  it('throws for an unknown field key', () => {
    expect(() =>
      setFieldStyle(baseSchema(), 'missing', { accent: '#000000' }),
    ).toThrow(SchemaHelperError)
  })
})
