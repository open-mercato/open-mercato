import {
  FieldTypeRegistry,
  V1_FIELD_TYPES,
  defaultFieldTypeRegistry,
  type FieldTypeSpec,
} from '../schema/field-type-registry'

describe('FieldTypeRegistry — v1 core types', () => {
  const allKeys = [
    'text',
    'textarea',
    'number',
    'integer',
    'boolean',
    'date',
    'datetime',
    'select_one',
    'select_many',
    'scale',
    'info_block',
  ] as const

  it('preloads exactly the 11 v1 types', () => {
    const keys = defaultFieldTypeRegistry.keys()
    expect(keys.sort()).toEqual([...allKeys].sort())
  })

  it('every preloaded type carries the required quartet', () => {
    for (const key of allKeys) {
      const spec = defaultFieldTypeRegistry.get(key)
      expect(spec).toBeDefined()
      expect(typeof spec!.validator).toBe('function')
      expect(spec!.renderer).toBeNull()
      expect(typeof spec!.exportAdapter).toBe('function')
      expect(spec!.defaultUiSchema).toBeDefined()
    }
  })

  describe('text', () => {
    it('accepts strings, rejects non-strings', () => {
      const spec = V1_FIELD_TYPES.text
      expect(spec.validator('hello', {})).toBe(true)
      expect(spec.validator(42, {})).not.toBe(true)
      expect(spec.exportAdapter('hello')).toBe('hello')
      expect(spec.exportAdapter(42)).toBe('')
    })
  })

  describe('textarea', () => {
    it('accepts strings, rejects non-strings', () => {
      const spec = V1_FIELD_TYPES.textarea
      expect(spec.validator('multi\nline', {})).toBe(true)
      expect(spec.validator(true, {})).not.toBe(true)
      expect(spec.exportAdapter('multi\nline')).toBe('multi\nline')
    })
  })

  describe('number', () => {
    it('accepts finite numbers, respects min/max bounds', () => {
      const spec = V1_FIELD_TYPES.number
      expect(spec.validator(3.14, {})).toBe(true)
      expect(spec.validator('foo', {})).not.toBe(true)
      expect(spec.validator(Number.NaN, {})).not.toBe(true)
      expect(spec.validator(5, { 'x-om-min': 10 })).not.toBe(true)
      expect(spec.validator(5, { 'x-om-max': 0 })).not.toBe(true)
      expect(spec.exportAdapter(3.14)).toBe('3.14')
      expect(spec.exportAdapter('foo')).toBe('')
    })
  })

  describe('integer', () => {
    it('accepts integers only', () => {
      const spec = V1_FIELD_TYPES.integer
      expect(spec.validator(7, {})).toBe(true)
      expect(spec.validator(7.5, {})).not.toBe(true)
      expect(spec.exportAdapter(7)).toBe('7')
      expect(spec.exportAdapter(7.5)).toBe('')
    })
  })

  describe('boolean', () => {
    it('accepts true/false; export shows Yes/No', () => {
      const spec = V1_FIELD_TYPES.boolean
      expect(spec.validator(true, {})).toBe(true)
      expect(spec.validator(false, {})).toBe(true)
      expect(spec.validator('true', {})).not.toBe(true)
      expect(spec.exportAdapter(true)).toBe('Yes')
      expect(spec.exportAdapter(false)).toBe('No')
      expect(spec.exportAdapter(null)).toBe('')
    })
  })

  describe('date', () => {
    it('accepts YYYY-MM-DD, rejects other shapes', () => {
      const spec = V1_FIELD_TYPES.date
      expect(spec.validator('2026-05-08', {})).toBe(true)
      expect(spec.validator('05/08/2026', {})).not.toBe(true)
      expect(spec.validator('not-a-date', {})).not.toBe(true)
      expect(spec.exportAdapter('2026-05-08')).toBe('2026-05-08')
    })
  })

  describe('datetime', () => {
    it('accepts ISO-parseable datetimes', () => {
      const spec = V1_FIELD_TYPES.datetime
      expect(spec.validator('2026-05-08T10:30:00Z', {})).toBe(true)
      expect(spec.validator('not-a-date', {})).not.toBe(true)
    })
  })

  describe('select_one', () => {
    it('rejects values outside x-om-options', () => {
      const spec = V1_FIELD_TYPES.select_one
      const fieldNode = {
        'x-om-options': [
          { value: 'yes', label: { en: 'Yes' } },
          { value: 'no', label: { en: 'No' } },
        ],
      }
      expect(spec.validator('yes', fieldNode)).toBe(true)
      expect(spec.validator('maybe', fieldNode)).not.toBe(true)
      expect(spec.exportAdapter('yes')).toBe('yes')
    })
  })

  describe('select_many', () => {
    it('accepts arrays of allowed values', () => {
      const spec = V1_FIELD_TYPES.select_many
      const fieldNode = {
        'x-om-options': [
          { value: 'a', label: { en: 'A' } },
          { value: 'b', label: { en: 'B' } },
        ],
      }
      expect(spec.validator(['a', 'b'], fieldNode)).toBe(true)
      expect(spec.validator(['a', 'c'], fieldNode)).not.toBe(true)
      expect(spec.validator('a', fieldNode)).not.toBe(true)
      expect(spec.exportAdapter(['a', 'b'])).toBe('a, b')
    })
  })

  describe('scale', () => {
    it('respects min/max defaults and bounds', () => {
      const spec = V1_FIELD_TYPES.scale
      expect(spec.validator(5, {})).toBe(true) // default 0..10
      expect(spec.validator(11, {})).not.toBe(true)
      expect(spec.validator(3, { 'x-om-min': 1, 'x-om-max': 5 })).toBe(true)
      expect(spec.validator(0, { 'x-om-min': 1, 'x-om-max': 5 })).not.toBe(true)
      expect(spec.validator(2.5, {})).not.toBe(true)
      expect(spec.exportAdapter(3)).toBe('3')
    })
  })

  describe('info_block', () => {
    it('always validates, exports empty string', () => {
      const spec = V1_FIELD_TYPES.info_block
      expect(spec.validator('anything', {})).toBe(true)
      expect(spec.validator(null, {})).toBe(true)
      expect(spec.exportAdapter('whatever')).toBe('')
    })
  })

  describe('registryVersion', () => {
    it('is stable for the same registered keys', () => {
      const a = new FieldTypeRegistry()
      const b = new FieldTypeRegistry()
      const stub: FieldTypeSpec = {
        validator: () => true,
        renderer: null,
        defaultUiSchema: {},
        exportAdapter: () => '',
      }
      a.register('text', stub)
      a.register('number', stub)
      b.register('number', stub)
      b.register('text', stub)
      expect(a.getRegistryVersion()).toBe(b.getRegistryVersion())
    })

    it('changes when a new type is registered', () => {
      const r = new FieldTypeRegistry()
      const stub: FieldTypeSpec = {
        validator: () => true,
        renderer: null,
        defaultUiSchema: {},
        exportAdapter: () => '',
      }
      r.register('text', stub)
      const before = r.getRegistryVersion()
      r.register('number', stub)
      const after = r.getRegistryVersion()
      expect(after).not.toBe(before)
    })

    it('starts with the v1 prefix on the default registry', () => {
      expect(defaultFieldTypeRegistry.getRegistryVersion()).toMatch(/^v1:[a-f0-9]+$/)
    })
  })
})
