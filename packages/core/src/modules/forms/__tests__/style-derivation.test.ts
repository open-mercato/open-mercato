import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import {
  FormVersionCompiler,
  resolveFieldStyle,
  resolveFormTheme,
  resolveSectionStyle,
} from '../services/form-version-compiler'

const themedSchema = () => ({
  type: 'object',
  'x-om-roles': ['admin', 'patient'],
  'x-om-default-actor-role': 'patient',
  'x-om-theme': {
    background: { kind: 'gradient', from: '#0f766e', to: '#ffffff', angle: 45 },
    surface: '#ffffff',
    foreground: '#111111',
    accent: '#0f766e',
    fontFamily: 'sans',
    radius: 'lg',
    contentWidth: 'md',
  },
  'x-om-sections': [
    {
      key: 'identity',
      title: { en: 'Identity' },
      fieldKeys: ['full_name'],
      style: {
        background: { kind: 'color', color: 'surface-muted' },
        padding: 'lg',
        border: 'subtle',
        radius: 'md',
        card: true,
        align: 'center',
      },
    },
  ],
  properties: {
    full_name: {
      type: 'string',
      minLength: 1,
      'x-om-type': 'text',
      'x-om-label': { en: 'Full name' },
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['admin', 'patient'],
      'x-om-style': {
        labelWeight: 'semibold',
        labelColor: '#111111',
        textColor: 'muted-foreground',
        accent: '#0f766e',
        align: 'start',
      },
    },
  },
  required: ['full_name'],
})

const unstyledSchema = () => ({
  type: 'object',
  'x-om-roles': ['admin', 'patient'],
  'x-om-default-actor-role': 'patient',
  'x-om-sections': [
    { key: 'identity', title: { en: 'Identity' }, fieldKeys: ['full_name'] },
  ],
  properties: {
    full_name: {
      type: 'string',
      minLength: 1,
      'x-om-type': 'text',
      'x-om-label': { en: 'Full name' },
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['admin', 'patient'],
    },
  },
  required: ['full_name'],
})

describe('resolveFormTheme', () => {
  it('returns the x-om-theme object when present', () => {
    const schema = themedSchema()
    expect(resolveFormTheme(schema)).toEqual(schema['x-om-theme'])
  })

  it('returns undefined when absent', () => {
    expect(resolveFormTheme(unstyledSchema())).toBeUndefined()
  })

  it('returns undefined for a malformed theme', () => {
    const schema = { 'x-om-theme': { accent: 'rgb(0,0,0)' } }
    expect(resolveFormTheme(schema)).toBeUndefined()
  })
})

describe('resolveSectionStyle', () => {
  it('returns the section style object when present', () => {
    const section = themedSchema()['x-om-sections'][0]
    expect(resolveSectionStyle(section)).toEqual(section.style)
  })

  it('returns undefined when absent', () => {
    const section = unstyledSchema()['x-om-sections'][0]
    expect(resolveSectionStyle(section)).toBeUndefined()
  })

  it('returns undefined for a malformed section style', () => {
    expect(resolveSectionStyle({ key: 's', style: { padding: 'enormous' } })).toBeUndefined()
  })
})

describe('resolveFieldStyle', () => {
  it('returns the x-om-style object when present', () => {
    const node = themedSchema().properties.full_name
    expect(resolveFieldStyle(node)).toEqual(node['x-om-style'])
  })

  it('returns undefined when absent', () => {
    const node = unstyledSchema().properties.full_name
    expect(resolveFieldStyle(node)).toBeUndefined()
  })

  it('returns undefined for a malformed field style', () => {
    expect(resolveFieldStyle({ 'x-om-style': { labelColor: 'red' } })).toBeUndefined()
  })
})

describe('no-mutation / hash invariance (R-CS-6)', () => {
  it('leaves the persisted schema byte-identical after resolving + compiling', () => {
    const schema = themedSchema()
    const clone = JSON.parse(JSON.stringify(schema))

    resolveFormTheme(schema)
    resolveSectionStyle(schema['x-om-sections'][0])
    resolveFieldStyle(schema.properties.full_name)

    const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry, cacheMax: 4 })
    compiler.compile({
      id: 'themed',
      updatedAt: new Date('2026-05-22T00:00:00Z'),
      schema,
      uiSchema: {},
    })

    expect(JSON.stringify(schema)).toEqual(JSON.stringify(clone))
  })

  it('produces a stable schemaHash across two compiles of the themed schema', () => {
    const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry, cacheMax: 4 })
    const first = compiler.compile({
      id: 'themed-a',
      updatedAt: new Date('2026-05-22T00:00:00Z'),
      schema: themedSchema(),
      uiSchema: {},
    })
    const second = compiler.compile({
      id: 'themed-b',
      updatedAt: new Date('2026-05-22T00:00:00Z'),
      schema: themedSchema(),
      uiSchema: {},
    })
    expect(first.schemaHash).toEqual(second.schemaHash)
  })

  it('adds nothing for the absent-styling case — hash equals a styling-free compile', () => {
    const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry, cacheMax: 4 })
    const before = compiler.compile({
      id: 'plain-a',
      updatedAt: new Date('2026-05-22T00:00:00Z'),
      schema: unstyledSchema(),
      uiSchema: {},
    })

    const schema = unstyledSchema()
    resolveFormTheme(schema)
    resolveSectionStyle(schema['x-om-sections'][0])
    resolveFieldStyle(schema.properties.full_name)

    const after = compiler.compile({
      id: 'plain-b',
      updatedAt: new Date('2026-05-22T00:00:00Z'),
      schema,
      uiSchema: {},
    })

    expect(after.schemaHash).toEqual(before.schemaHash)
  })
})
