import { FieldTypeRegistry, defaultFieldTypeRegistry } from '../schema/field-type-registry'
import {
  FormCompilationError,
  FormVersionCompiler,
} from '../services/form-version-compiler'

const baseSchema = () => ({
  type: 'object',
  'x-om-roles': ['admin', 'patient'],
  'x-om-default-actor-role': 'patient',
  'x-om-sections': [
    { key: 'identity', title: { en: 'Identity' }, fieldKeys: ['full_name'] },
    { key: 'health', title: { en: 'Health' }, fieldKeys: ['has_allergies'] },
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
    has_allergies: {
      type: 'boolean',
      'x-om-type': 'boolean',
      'x-om-label': { en: 'Any allergies?' },
      'x-om-editable-by': ['patient'],
      'x-om-sensitive': true,
    },
  },
  required: ['full_name'],
})

describe('FormVersionCompiler', () => {
  let compiler: FormVersionCompiler

  beforeEach(() => {
    compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry, cacheMax: 4 })
  })

  it('compiles a valid schema and exposes ajv + zod + fieldIndex + role policy + registry version', () => {
    const compiled = compiler.compile({
      id: 'v1',
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      schema: baseSchema(),
      uiSchema: { full_name: { 'ui:widget': 'text' } },
    })

    expect(compiled.schemaHash).toMatch(/^[a-f0-9]{64}$/)
    expect(compiled.registryVersion).toMatch(/^v1:/)
    expect(compiled.ajv({ full_name: 'Jane' })).toBe(true)
    expect(compiled.ajv({})).toBe(false)

    const zodResult = compiled.zod.safeParse({ full_name: 'Jane' })
    expect(zodResult.success).toBe(true)

    expect(compiled.fieldIndex.full_name).toMatchObject({
      key: 'full_name',
      type: 'text',
      sectionKey: 'identity',
      sensitive: false,
      editableBy: ['patient'],
      required: true,
    })
    expect(compiled.fieldIndex.has_allergies.sensitive).toBe(true)

    const patientCanWrite = compiled.rolePolicyLookup('patient', 'full_name')
    expect(patientCanWrite).toEqual({ canRead: true, canWrite: true })
    const adminPolicy = compiled.rolePolicyLookup('admin', 'full_name')
    expect(adminPolicy.canRead).toBe(true)
    expect(adminPolicy.canWrite).toBe(false) // admin not in editable-by here
    const strangerPolicy = compiled.rolePolicyLookup('stranger', 'full_name')
    expect(strangerPolicy).toEqual({ canRead: false, canWrite: false })
  })

  it('hashes are stable across key reordering of schema and uiSchema', () => {
    const a = compiler.compile({
      id: 'v1',
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      schema: baseSchema(),
      uiSchema: { full_name: { 'ui:widget': 'text', 'ui:autofocus': true } },
    })
    const reorderedSchema = baseSchema()
    // Rebuild same content with different insertion order.
    const reordered = {
      properties: reorderedSchema.properties,
      required: reorderedSchema.required,
      'x-om-default-actor-role': reorderedSchema['x-om-default-actor-role'],
      'x-om-sections': reorderedSchema['x-om-sections'],
      'x-om-roles': reorderedSchema['x-om-roles'],
      type: reorderedSchema.type,
    }
    const b = compiler.compile({
      id: 'v2',
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      schema: reordered,
      uiSchema: { full_name: { 'ui:autofocus': true, 'ui:widget': 'text' } },
    })
    expect(a.schemaHash).toBe(b.schemaHash)
  })

  it('rejects fields missing the JSON Schema "type" keyword', () => {
    const schema = baseSchema()
    delete (schema.properties.full_name as Record<string, unknown>).type
    expect(() =>
      compiler.compile({ id: 'v1', updatedAt: new Date(), schema, uiSchema: {} }),
    ).toThrow(FormCompilationError)
    try {
      compiler.compile({ id: 'v1', updatedAt: new Date(), schema, uiSchema: {} })
    } catch (error) {
      expect((error as FormCompilationError).code).toBe('INVALID_SCHEMA_SHAPE')
      expect((error as FormCompilationError).path).toEqual(['properties', 'full_name', 'type'])
    }
  })

  it('rejects fields missing x-om-type', () => {
    const schema = baseSchema()
    delete (schema.properties.full_name as Record<string, unknown>)['x-om-type']
    try {
      compiler.compile({ id: 'v1', updatedAt: new Date(), schema, uiSchema: {} })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as FormCompilationError).code).toBe('MISSING_TYPE')
    }
  })

  it('rejects fields with an unregistered x-om-type', () => {
    const schema = baseSchema()
    ;(schema.properties.full_name as Record<string, unknown>)['x-om-type'] = 'unicorn'
    try {
      compiler.compile({ id: 'v1', updatedAt: new Date(), schema, uiSchema: {} })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as FormCompilationError).code).toBe('UNKNOWN_TYPE')
    }
  })

  it('rejects fields whose editable-by role is not in x-om-roles', () => {
    const schema = baseSchema()
    ;(schema.properties.full_name as Record<string, unknown>)['x-om-editable-by'] = ['ghost']
    try {
      compiler.compile({ id: 'v1', updatedAt: new Date(), schema, uiSchema: {} })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as FormCompilationError).code).toBe('ROLE_NOT_DECLARED')
    }
  })

  it('rejects invalid regex patterns', () => {
    const schema = baseSchema()
    ;(schema.properties.full_name as Record<string, unknown>).pattern = '['
    try {
      compiler.compile({ id: 'v1', updatedAt: new Date(), schema, uiSchema: {} })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as FormCompilationError).code).toBe('INVALID_REGEX_PATTERN')
    }
  })

  it('caches by (id, updatedAt) and returns the same compiled object on a hit', () => {
    const updatedAt = new Date('2026-05-01T00:00:00Z')
    const first = compiler.compile({ id: 'cached', updatedAt, schema: baseSchema(), uiSchema: {} })
    const second = compiler.compile({ id: 'cached', updatedAt, schema: baseSchema(), uiSchema: {} })
    expect(first).toBe(second)
  })

  it('invalidates the cache when updatedAt changes', () => {
    const first = compiler.compile({
      id: 'cached',
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      schema: baseSchema(),
      uiSchema: {},
    })
    const second = compiler.compile({
      id: 'cached',
      updatedAt: new Date('2026-05-02T00:00:00Z'),
      schema: baseSchema(),
      uiSchema: {},
    })
    expect(first).not.toBe(second)
    expect(first.schemaHash).toBe(second.schemaHash) // same content => same hash
  })

  it('respects cacheMax — LRU eviction kicks in', () => {
    const dates = Array.from({ length: 6 }, (_, i) => new Date(`2026-05-0${i + 1}T00:00:00Z`))
    for (const d of dates) {
      compiler.compile({ id: 'lru', updatedAt: d, schema: baseSchema(), uiSchema: {} })
    }
    expect(compiler.size()).toBeLessThanOrEqual(4)
  })

  it('populates FieldDescriptor.validations from x-om-pattern / x-om-min-length / x-om-max-length', () => {
    const schema = baseSchema()
    Object.assign(schema.properties.full_name as Record<string, unknown>, {
      'x-om-pattern': '^[A-Z][a-z]+$',
      'x-om-min-length': 1,
      'x-om-max-length': 64,
    })
    const compiled = compiler.compile({
      id: 'with-validations',
      updatedAt: new Date('2026-05-14T00:00:00Z'),
      schema,
      uiSchema: {},
    })
    expect(compiled.fieldIndex.full_name.validations).toEqual([
      { type: 'pattern', pattern: '^[A-Z][a-z]+$' },
      { type: 'minLength', value: 1 },
      { type: 'maxLength', value: 64 },
    ])
  })

  it('surfaces validation message overrides on the descriptor', () => {
    const schema = baseSchema()
    Object.assign(schema.properties.full_name as Record<string, unknown>, {
      'x-om-pattern': '^.+$',
      'x-om-validation-messages': {
        en: { pattern: 'Please type your name.' },
      },
    })
    const compiled = compiler.compile({
      id: 'with-messages',
      updatedAt: new Date('2026-05-14T01:00:00Z'),
      schema,
      uiSchema: {},
    })
    expect(compiled.fieldIndex.full_name.validationMessages).toEqual({
      en: { pattern: 'Please type your name.' },
    })
  })

  it('schema hash survives a JSON-clone round-trip with validation keywords', () => {
    const schema = baseSchema()
    Object.assign(schema.properties.full_name as Record<string, unknown>, {
      'x-om-pattern': '^[A-Z][a-z]+$',
      'x-om-min-length': 1,
      'x-om-max-length': 64,
      'x-om-validation-messages': { en: { pattern: 'No.' } },
    })
    const a = compiler.compile({
      id: 'hash-a',
      updatedAt: new Date('2026-05-14T02:00:00Z'),
      schema,
      uiSchema: { full_name: { 'ui:widget': 'text' } },
    })
    const cloned = JSON.parse(JSON.stringify(schema))
    const b = compiler.compile({
      id: 'hash-b',
      updatedAt: new Date('2026-05-14T02:00:00Z'),
      schema: cloned,
      uiSchema: { full_name: { 'ui:widget': 'text' } },
    })
    expect(a.schemaHash).toBe(b.schemaHash)
  })

  it('emits a format rule on the descriptor for an email field (Tier-2 Phase B)', () => {
    const schema = baseSchema()
    ;(schema.properties as Record<string, unknown>)['contact_email'] = {
      type: 'string',
      'x-om-type': 'email',
      'x-om-label': { en: 'Email' },
      'x-om-editable-by': ['patient'],
    }
    ;(schema['x-om-sections'] as Array<{ key: string; fieldKeys: string[] }>)[0]
      .fieldKeys.push('contact_email')
    const compiled = compiler.compile({
      id: 'with-email',
      updatedAt: new Date('2026-05-14T03:00:00Z'),
      schema,
      uiSchema: {},
    })
    expect(compiled.fieldIndex.contact_email.type).toBe('email')
    expect(compiled.fieldIndex.contact_email.validations).toEqual([
      { type: 'format', format: 'email' },
    ])
  })

  it('compiles an address field cleanly (Tier-2 Phase C composite)', () => {
    const schema = baseSchema()
    ;(schema.properties as Record<string, unknown>)['billing_address'] = {
      type: 'object',
      'x-om-type': 'address',
      'x-om-label': { en: 'Billing address' },
      'x-om-editable-by': ['patient'],
      properties: {
        street1: { type: 'string' },
        street2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        country: { type: 'string' },
      },
      required: ['street1', 'city', 'country'],
      additionalProperties: false,
    }
    ;(schema['x-om-sections'] as Array<{ key: string; fieldKeys: string[] }>)[0]
      .fieldKeys.push('billing_address')
    const compiled = compiler.compile({
      id: 'with-address',
      updatedAt: new Date('2026-05-14T05:00:00Z'),
      schema,
      uiSchema: {},
    })
    expect(compiled.fieldIndex.billing_address.type).toBe('address')
    expect(compiled.fieldIndex.billing_address.validations).toEqual([])
    expect(
      compiled.ajv({
        full_name: 'Jane',
        billing_address: {
          street1: '123 Main St',
          city: 'Springfield',
          country: 'US',
        },
      }),
    ).toBe(true)
  })

  it('captures the registry version from the registry', () => {
    const registry = new FieldTypeRegistry()
    registry.register('text', defaultFieldTypeRegistry.get('text')!)
    registry.register('boolean', defaultFieldTypeRegistry.get('boolean')!)
    const customCompiler = new FormVersionCompiler({ registry })
    const version = registry.getRegistryVersion()
    const compiled = customCompiler.compile({
      id: 'simple',
      updatedAt: new Date(),
      schema: {
        type: 'object',
        'x-om-roles': ['admin'],
        properties: {
          name: { type: 'string', 'x-om-type': 'text' },
        },
      },
      uiSchema: {},
    })
    expect(compiled.registryVersion).toBe(version)
  })
})
