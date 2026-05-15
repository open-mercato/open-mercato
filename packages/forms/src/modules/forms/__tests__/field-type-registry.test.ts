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
    'yes_no',
    'date',
    'datetime',
    'select_one',
    'select_many',
    'scale',
    'info_block',
    'email',
    'phone',
    'website',
    'address',
    'nps',
    'opinion_scale',
    'ranking',
    'matrix',
  ] as const

  it('preloads exactly the 12 v1 types plus Tier-2 additions', () => {
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

  describe('yes_no', () => {
    it('shares boolean semantics with a yes_no widget hint', () => {
      const spec = V1_FIELD_TYPES.yes_no
      expect(spec.validator(true, {})).toBe(true)
      expect(spec.validator(false, {})).toBe(true)
      expect(spec.validator('yes', {})).not.toBe(true)
      expect(spec.exportAdapter(true)).toBe('Yes')
      expect(spec.exportAdapter(false)).toBe('No')
      expect(spec.defaultUiSchema.widget).toBe('yes_no')
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

  describe('email (Tier-2)', () => {
    it('accepts well-formed addresses, rejects malformed strings', () => {
      const spec = V1_FIELD_TYPES.email
      expect(spec.validator('alice@example.com', {})).toBe(true)
      expect(spec.validator('bob+tag@sub.example.io', {})).toBe(true)
      expect(spec.validator('not-an-email', {})).not.toBe(true)
      expect(spec.validator('missing@host', {})).not.toBe(true)
      expect(spec.validator(42, {})).not.toBe(true)
    })

    it('treats an empty string as valid (required-ness is JSON-Schema enforced)', () => {
      expect(V1_FIELD_TYPES.email.validator('', {})).toBe(true)
    })

    it('honours x-om-pattern overrides', () => {
      const spec = V1_FIELD_TYPES.email
      const fieldNode = { 'x-om-pattern': '^[a-z]+@example\\.com$' }
      expect(spec.validator('alice@example.com', fieldNode)).toBe(true)
      expect(spec.validator('alice@other.com', fieldNode)).not.toBe(true)
    })

    it('registers with input category, mail icon, and the survey display key', () => {
      const spec = V1_FIELD_TYPES.email
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('mail')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.email')
      expect(spec.renderer).toBeNull()
      expect(spec.defaultUiSchema).toEqual({ widget: 'email' })
      expect(spec.exportAdapter('alice@example.com')).toBe('alice@example.com')
      expect(spec.exportAdapter(42)).toBe('')
    })
  })

  describe('phone (Tier-2)', () => {
    it('accepts well-formed phone strings, rejects garbage', () => {
      const spec = V1_FIELD_TYPES.phone
      expect(spec.validator('+1 (555) 555-0123', {})).toBe(true)
      expect(spec.validator('555-5555', {})).toBe(true)
      expect(spec.validator('abc', {})).not.toBe(true)
    })

    it('treats an empty string as valid', () => {
      expect(V1_FIELD_TYPES.phone.validator('', {})).toBe(true)
    })

    it('honours x-om-pattern overrides', () => {
      const spec = V1_FIELD_TYPES.phone
      const fieldNode = { 'x-om-pattern': '^\\d{3}-\\d{4}$' }
      expect(spec.validator('555-1234', fieldNode)).toBe(true)
      expect(spec.validator('+1 555-1234', fieldNode)).not.toBe(true)
    })

    it('registers with input category, phone icon, and the survey display key', () => {
      const spec = V1_FIELD_TYPES.phone
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('phone')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.phone')
      expect(spec.defaultUiSchema).toEqual({ widget: 'phone' })
    })
  })

  describe('website (Tier-2)', () => {
    it('accepts http(s) URLs, rejects bare strings', () => {
      const spec = V1_FIELD_TYPES.website
      expect(spec.validator('https://example.com', {})).toBe(true)
      expect(spec.validator('http://example.com/path?x=1', {})).toBe(true)
      expect(spec.validator('example.com', {})).not.toBe(true)
      expect(spec.validator('ftp://example.com', {})).not.toBe(true)
    })

    it('treats an empty string as valid', () => {
      expect(V1_FIELD_TYPES.website.validator('', {})).toBe(true)
    })

    it('honours x-om-pattern overrides', () => {
      const spec = V1_FIELD_TYPES.website
      const fieldNode = { 'x-om-pattern': '^https://example\\.com/.*$' }
      expect(spec.validator('https://example.com/page', fieldNode)).toBe(true)
      expect(spec.validator('https://other.com/page', fieldNode)).not.toBe(true)
    })

    it('registers with input category, globe icon, and the survey display key', () => {
      const spec = V1_FIELD_TYPES.website
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('globe')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.website')
      expect(spec.defaultUiSchema).toEqual({ widget: 'website' })
    })
  })

  describe('address (Tier-2 — Phase C)', () => {
    const spec = V1_FIELD_TYPES.address

    const completeAddress = {
      street1: '123 Main St',
      city: 'Springfield',
      region: 'IL',
      postalCode: '62701',
      country: 'US',
    }

    it('registers with the full quartet', () => {
      expect(typeof spec.validator).toBe('function')
      expect(spec.renderer).toBeNull()
      expect(typeof spec.exportAdapter).toBe('function')
      expect(spec.defaultUiSchema).toEqual({ widget: 'address' })
    })

    it('registers with input category, map-pin icon, and the survey display key', () => {
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('map-pin')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.address')
    })

    it('treats null / undefined as valid (required-ness enforced elsewhere)', () => {
      expect(spec.validator(null, {})).toBe(true)
      expect(spec.validator(undefined, {})).toBe(true)
    })

    it('rejects arrays and non-objects', () => {
      expect(spec.validator([], {})).not.toBe(true)
      expect(spec.validator('123 Main St', {})).not.toBe(true)
      expect(spec.validator(42, {})).not.toBe(true)
    })

    it('rejects when a required sub-field is missing or empty', () => {
      expect(spec.validator({ city: 'Springfield', country: 'US' }, {})).not.toBe(true)
      expect(
        spec.validator({ street1: '   ', city: 'Springfield', country: 'US' }, {}),
      ).not.toBe(true)
      expect(spec.validator({ street1: '123', country: 'US' }, {})).not.toBe(true)
    })

    it('rejects when a required sub-field is the wrong type', () => {
      expect(
        spec.validator({ street1: 1 as unknown as string, city: 'x', country: 'US' }, {}),
      ).not.toBe(true)
    })

    it('rejects unknown sub-keys', () => {
      expect(
        spec.validator({ ...completeAddress, gibberish: 'no' }, {}),
      ).toBe('Address contains unknown fields.')
    })

    it('rejects non-string optional sub-values', () => {
      expect(
        spec.validator(
          { ...completeAddress, region: 99 as unknown as string },
          {},
        ),
      ).not.toBe(true)
    })

    it('accepts a complete valid address', () => {
      expect(spec.validator(completeAddress, {})).toBe(true)
    })

    it('accepts a minimal address with only required fields populated', () => {
      expect(
        spec.validator({ street1: '123', city: 'Springfield', country: 'US' }, {}),
      ).toBe(true)
    })

    it('exports a comma-joined one-liner with region + postalCode space-joined', () => {
      expect(spec.exportAdapter(completeAddress)).toBe('123 Main St, Springfield, IL 62701, US')
    })

    it('includes street2 in the export when present', () => {
      expect(
        spec.exportAdapter({ ...completeAddress, street2: 'Apt 4B' }),
      ).toBe('123 Main St, Apt 4B, Springfield, IL 62701, US')
    })

    it('skips missing optional pieces and skips the region/postal slot when both empty', () => {
      expect(
        spec.exportAdapter({ street1: '123 Main St', city: 'Springfield', country: 'US' }),
      ).toBe('123 Main St, Springfield, US')
    })

    it('partial address with only required fields still exports cleanly', () => {
      expect(
        spec.exportAdapter({ street1: '7 Elm', city: 'Boston', country: 'US' }),
      ).toBe('7 Elm, Boston, US')
    })

    it('exports an empty string for non-object values', () => {
      expect(spec.exportAdapter(null)).toBe('')
      expect(spec.exportAdapter(undefined)).toBe('')
      expect(spec.exportAdapter('123 Main St')).toBe('')
      expect(spec.exportAdapter([])).toBe('')
    })
  })

  describe('nps (Tier-2 — Phase D)', () => {
    const spec = V1_FIELD_TYPES.nps

    it('registers with the full quartet + survey palette metadata', () => {
      expect(typeof spec.validator).toBe('function')
      expect(spec.renderer).toBeNull()
      expect(typeof spec.exportAdapter).toBe('function')
      expect(spec.defaultUiSchema).toEqual({ widget: 'nps' })
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('gauge')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.nps')
    })

    it('accepts integers in 0..10', () => {
      for (let value = 0; value <= 10; value += 1) {
        expect(spec.validator(value, {})).toBe(true)
      }
    })

    it('rejects 11, -1, non-integer, and non-numbers', () => {
      expect(spec.validator(11, {})).not.toBe(true)
      expect(spec.validator(-1, {})).not.toBe(true)
      expect(spec.validator(3.5, {})).not.toBe(true)
      expect(spec.validator('5', {})).not.toBe(true)
      expect(spec.validator(null, {})).not.toBe(true)
    })

    it('exports with the matching promoter / passive / detractor band', () => {
      expect(spec.exportAdapter(0)).toBe('0 (Detractor)')
      expect(spec.exportAdapter(6)).toBe('6 (Detractor)')
      expect(spec.exportAdapter(7)).toBe('7 (Passive)')
      expect(spec.exportAdapter(8)).toBe('8 (Passive)')
      expect(spec.exportAdapter(9)).toBe('9 (Promoter)')
      expect(spec.exportAdapter(10)).toBe('10 (Promoter)')
    })

    it('exports non-numbers and out-of-range as the empty string', () => {
      expect(spec.exportAdapter(null)).toBe('')
      expect(spec.exportAdapter('5')).toBe('')
      expect(spec.exportAdapter(11)).toBe('')
      expect(spec.exportAdapter(-1)).toBe('')
    })
  })

  describe('opinion_scale (Tier-2 — Phase D)', () => {
    const spec = V1_FIELD_TYPES.opinion_scale

    it('registers with the full quartet + survey palette metadata', () => {
      expect(typeof spec.validator).toBe('function')
      expect(spec.renderer).toBeNull()
      expect(typeof spec.exportAdapter).toBe('function')
      expect(spec.defaultUiSchema).toEqual({ widget: 'opinion_scale' })
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('star')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.opinion')
    })

    it('respects defaults 1..5 when no x-om-min/max', () => {
      expect(spec.validator(1, {})).toBe(true)
      expect(spec.validator(5, {})).toBe(true)
      expect(spec.validator(0, {})).not.toBe(true)
      expect(spec.validator(6, {})).not.toBe(true)
    })

    it('respects explicit x-om-min and x-om-max overrides', () => {
      const node = { 'x-om-min': 1, 'x-om-max': 7 }
      expect(spec.validator(1, node)).toBe(true)
      expect(spec.validator(7, node)).toBe(true)
      expect(spec.validator(8, node)).not.toBe(true)
    })

    it('rejects non-integer / non-number values', () => {
      expect(spec.validator(3.5, {})).not.toBe(true)
      expect(spec.validator('3', {})).not.toBe(true)
      expect(spec.validator(null, {})).not.toBe(true)
    })

    it('exports `<value>/<max>` with default max=5', () => {
      expect(spec.exportAdapter(4, {})).toBe('4/5')
    })

    it('exports `<value>/<max>` honouring x-om-max', () => {
      expect(spec.exportAdapter(5, { 'x-om-max': 7 })).toBe('5/7')
    })

    it('exports non-number values as the empty string', () => {
      expect(spec.exportAdapter(null)).toBe('')
      expect(spec.exportAdapter('3')).toBe('')
    })
  })

  describe('ranking (Tier-2 — Phase E)', () => {
    const spec = V1_FIELD_TYPES.ranking

    const optionsNode = {
      'x-om-options': [
        { value: 'a', label: { en: 'A' } },
        { value: 'b', label: { en: 'B' } },
        { value: 'c', label: { en: 'C' } },
        { value: 'd', label: { en: 'D' } },
        { value: 'e', label: { en: 'E' } },
      ],
    }

    it('registers with the full quartet + survey palette metadata', () => {
      expect(typeof spec.validator).toBe('function')
      expect(spec.renderer).toBeNull()
      expect(typeof spec.exportAdapter).toBe('function')
      expect(spec.defaultUiSchema).toEqual({ widget: 'ranking' })
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('list-ordered')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.ranking')
    })

    it('treats null / undefined as valid (required-ness enforced elsewhere)', () => {
      expect(spec.validator(null, optionsNode)).toBe(true)
      expect(spec.validator(undefined, optionsNode)).toBe(true)
    })

    it('rejects non-array values', () => {
      expect(spec.validator('a', optionsNode)).not.toBe(true)
      expect(spec.validator(42, optionsNode)).not.toBe(true)
      expect(spec.validator({}, optionsNode)).not.toBe(true)
    })

    it('rejects entries outside x-om-options', () => {
      expect(spec.validator(['a', 'zzz'], optionsNode)).not.toBe(true)
    })

    it('rejects duplicate entries', () => {
      expect(spec.validator(['a', 'a'], optionsNode)).not.toBe(true)
    })

    it('rejects non-string entries', () => {
      expect(spec.validator(['a', 1 as unknown as string], optionsNode)).not.toBe(true)
    })

    it('accepts a partial ranking by default', () => {
      expect(spec.validator(['a', 'b'], optionsNode)).toBe(true)
    })

    it('accepts a complete ranking when exhaustive is true', () => {
      expect(
        spec.validator(
          ['a', 'b', 'c', 'd', 'e'],
          { ...optionsNode, 'x-om-ranking-exhaustive': true },
        ),
      ).toBe(true)
    })

    it('rejects a partial ranking when exhaustive is true', () => {
      expect(
        spec.validator(
          ['a', 'b'],
          { ...optionsNode, 'x-om-ranking-exhaustive': true },
        ),
      ).not.toBe(true)
    })

    it('exports a complete ranking as A > B > C', () => {
      expect(
        spec.exportAdapter(
          ['a', 'b', 'c', 'd', 'e'],
          { ...optionsNode, 'x-om-ranking-exhaustive': true },
        ),
      ).toBe('a > b > c > d > e')
    })

    it('exports a partial non-exhaustive ranking with the (partial; N unranked) suffix', () => {
      expect(spec.exportAdapter(['a', 'b'], optionsNode)).toBe(
        'a > b (partial; 3 unranked)',
      )
    })

    it('does not append the suffix when every option is ranked (non-exhaustive)', () => {
      expect(
        spec.exportAdapter(['a', 'b', 'c', 'd', 'e'], optionsNode),
      ).toBe('a > b > c > d > e')
    })

    it('exports an empty string for non-array values', () => {
      expect(spec.exportAdapter(null)).toBe('')
      expect(spec.exportAdapter(undefined)).toBe('')
      expect(spec.exportAdapter('a')).toBe('')
    })

    it('exports without options node by just joining the array', () => {
      expect(spec.exportAdapter(['a', 'b'])).toBe('a > b')
    })
  })

  describe('matrix (Tier-2 — Phase F)', () => {
    const spec = V1_FIELD_TYPES.matrix

    const fieldNode = {
      'x-om-matrix-rows': [
        { key: 'communication', label: { en: 'Communication' } },
        { key: 'wait_time', label: { en: 'Wait time' }, required: true },
        { key: 'concerns', label: { en: 'Concerns' }, multiple: true },
      ],
      'x-om-matrix-columns': [
        { value: 'agree', label: { en: 'Agree' } },
        { value: 'neutral', label: { en: 'Neutral' } },
        { value: 'strongly_agree', label: { en: 'Strongly agree' } },
      ],
    }

    it('registers with the full quartet + survey palette metadata', () => {
      expect(typeof spec.validator).toBe('function')
      expect(spec.renderer).toBeNull()
      expect(typeof spec.exportAdapter).toBe('function')
      expect(spec.defaultUiSchema).toEqual({ widget: 'matrix' })
      expect(spec.category).toBe('input')
      expect(spec.icon).toBe('grid-3x3')
      expect(spec.displayNameKey).toBe('forms.studio.palette.survey.matrix')
    })

    it('treats null / undefined as valid', () => {
      expect(spec.validator(null, fieldNode)).toBe(true)
      expect(spec.validator(undefined, fieldNode)).toBe(true)
    })

    it('rejects arrays and non-objects', () => {
      expect(spec.validator([], fieldNode)).not.toBe(true)
      expect(spec.validator('agree', fieldNode)).not.toBe(true)
    })

    it('accepts a complete object with allowed column values', () => {
      const value = {
        communication: 'agree',
        wait_time: 'neutral',
        concerns: ['agree', 'neutral'],
      }
      expect(spec.validator(value, fieldNode)).toBe(true)
    })

    it('rejects unknown row keys', () => {
      expect(
        spec.validator({ communication: 'agree', mystery: 'x' } as Record<string, unknown>, fieldNode),
      ).not.toBe(true)
    })

    it('rejects unknown column values', () => {
      expect(spec.validator({ communication: 'gibberish' }, fieldNode)).not.toBe(true)
    })

    it('rejects single-select rows that receive arrays', () => {
      expect(spec.validator({ communication: ['agree'] }, fieldNode)).not.toBe(true)
    })

    it('rejects multi-select rows that receive a string', () => {
      expect(spec.validator({ concerns: 'agree' }, fieldNode)).not.toBe(true)
    })

    it('rejects multi-select rows with duplicate entries', () => {
      expect(spec.validator({ concerns: ['agree', 'agree'] }, fieldNode)).not.toBe(true)
    })

    it('rejects when a required row is missing or empty', () => {
      expect(spec.validator({ communication: 'agree' }, fieldNode)).not.toBe(true)
      expect(spec.validator({ communication: 'agree', wait_time: '' }, fieldNode)).not.toBe(true)
    })

    it('exports as `row → value; row → value; …` with multi-select joined by `+`', () => {
      const value = {
        communication: 'agree',
        wait_time: 'neutral',
        concerns: ['agree', 'neutral'],
      }
      expect(spec.exportAdapter(value, fieldNode)).toBe(
        'Communication → agree; Wait time → neutral; Concerns → agree+neutral',
      )
    })

    it('exports missing rows as `row → —`', () => {
      const value = { communication: 'agree' }
      expect(spec.exportAdapter(value, fieldNode)).toBe(
        'Communication → agree; Wait time → —; Concerns → —',
      )
    })

    it('exports empty string for non-object values', () => {
      expect(spec.exportAdapter(null)).toBe('')
      expect(spec.exportAdapter('agree')).toBe('')
      expect(spec.exportAdapter([])).toBe('')
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

  describe('palette metadata (visual builder Phase A)', () => {
    it('info_block is categorized as layout (Decision 7a)', () => {
      expect(V1_FIELD_TYPES.info_block.category).toBe('layout')
      expect(V1_FIELD_TYPES.info_block.displayNameKey).toBe('forms.studio.palette.layout.infoBlock')
    })

    it('every other v1 type is categorized as input', () => {
      const inputKeys = allKeys.filter((key) => key !== 'info_block')
      for (const key of inputKeys) {
        const spec = V1_FIELD_TYPES[key]
        expect(spec.category).toBe('input')
      }
    })

    it('every v1 spec carries an icon name and a translation key', () => {
      for (const key of allKeys) {
        const spec = V1_FIELD_TYPES[key]
        expect(typeof spec.icon).toBe('string')
        expect(spec.icon!.length).toBeGreaterThan(0)
        expect(typeof spec.displayNameKey).toBe('string')
        expect(spec.displayNameKey!.startsWith('forms.studio.palette.')).toBe(true)
      }
    })

    it('treats unset category as input (additive default)', () => {
      const stub: FieldTypeSpec = {
        validator: () => true,
        renderer: null,
        defaultUiSchema: {},
        exportAdapter: () => '',
      }
      const r = new FieldTypeRegistry()
      r.register('legacy', stub)
      const resolved = r.get('legacy')!
      const category = resolved.category ?? 'input'
      expect(category).toBe('input')
    })
  })
})
