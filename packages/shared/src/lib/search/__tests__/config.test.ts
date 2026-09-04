import {
  DEFAULT_SEARCH_MAX_FIELD_CHARS,
  DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD,
  DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD,
  DEFAULT_SEARCH_MIN_TOKEN_LENGTH,
  isSearchFieldBlocklisted,
  resolveSearchConfig,
  resolveSearchMinTokenLength,
  resolveSearchTokenLimits,
} from '../config'

describe('resolveSearchMinTokenLength', () => {
  const originalValue = process.env.OM_SEARCH_MIN_LEN

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.OM_SEARCH_MIN_LEN
    } else {
      process.env.OM_SEARCH_MIN_LEN = originalValue
    }
  })

  it('returns the default when OM_SEARCH_MIN_LEN is unset', () => {
    delete process.env.OM_SEARCH_MIN_LEN
    expect(resolveSearchMinTokenLength()).toBe(DEFAULT_SEARCH_MIN_TOKEN_LENGTH)
  })

  it('parses a positive integer', () => {
    process.env.OM_SEARCH_MIN_LEN = '4'
    expect(resolveSearchMinTokenLength()).toBe(4)
  })

  it('falls back to the default for non-numeric values', () => {
    process.env.OM_SEARCH_MIN_LEN = 'abc'
    expect(resolveSearchMinTokenLength()).toBe(DEFAULT_SEARCH_MIN_TOKEN_LENGTH)
  })

  it('falls back to the default for values below the floor', () => {
    process.env.OM_SEARCH_MIN_LEN = '0'
    expect(resolveSearchMinTokenLength()).toBe(DEFAULT_SEARCH_MIN_TOKEN_LENGTH)
  })

  it('keeps resolveSearchConfig().minTokenLength in sync', () => {
    process.env.OM_SEARCH_MIN_LEN = '5'
    expect(resolveSearchConfig().minTokenLength).toBe(resolveSearchMinTokenLength())
  })
})

describe('OM_SEARCH_FIELD_BLOCKLIST parsing', () => {
  const originalValue = process.env.OM_SEARCH_FIELD_BLOCKLIST

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    } else {
      process.env.OM_SEARCH_FIELD_BLOCKLIST = originalValue
    }
  })

  it('always includes the built-in defaults', () => {
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const config = resolveSearchConfig()
    expect(config.blocklistedFields).toEqual(expect.arrayContaining(['password', 'token', 'secret', 'hash']))
    expect(config.entityBlocklistedFields).toEqual({})
  })

  it('treats an unprefixed entry as global and lowercases it', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = ' Body , body '
    const config = resolveSearchConfig()
    expect(config.blocklistedFields.filter((entry) => entry === 'body')).toHaveLength(1)
    expect(config.entityBlocklistedFields).toEqual({})
  })

  it('routes an entityType@field entry into the per-entity map only', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'customers:customer_interaction@body'
    const config = resolveSearchConfig()
    expect(config.blocklistedFields).not.toContain('body')
    expect(config.entityBlocklistedFields).toEqual({ 'customers:customer_interaction': ['body'] })
  })

  it('groups several fields under the same entity type', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'customers:customer_interaction@body,customers:customer_interaction@subject'
    expect(resolveSearchConfig().entityBlocklistedFields).toEqual({
      'customers:customer_interaction': ['body', 'subject'],
    })
  })

  it('ignores entries whose field part is empty', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'customers:customer_interaction@,@,body'
    const config = resolveSearchConfig()
    expect(config.blocklistedFields).toContain('body')
    expect(config.entityBlocklistedFields).toEqual({})
  })

  it('treats a leading separator as a global entry', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = '@body'
    const config = resolveSearchConfig()
    expect(config.blocklistedFields).toContain('body')
    expect(config.entityBlocklistedFields).toEqual({})
  })

  it('stores entity types that collide with inherited object keys as own entries', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'constructor@body,toString@summary,__proto__@notes'
    const config = resolveSearchConfig()

    expect(Object.getPrototypeOf(config.entityBlocklistedFields)).toBeNull()
    expect(config.entityBlocklistedFields?.['constructor']).toEqual(['body'])
    expect(config.entityBlocklistedFields?.['tostring']).toEqual(['summary'])
    expect(config.entityBlocklistedFields?.['__proto__']).toEqual(['notes'])
    expect(isSearchFieldBlocklisted('body', 'constructor', config)).toBe(true)
    expect(isSearchFieldBlocklisted('summary', 'toString', config)).toBe(true)
    expect(isSearchFieldBlocklisted('notes', '__proto__', config)).toBe(true)
  })
})

describe('OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS', () => {
  const originalValue = process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS
    } else {
      process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS = originalValue
    }
  })

  // #5803: with the rewrite applied to plaintext columns, a list search for `2026-08` came back
  // with the `2026-01` row, because both tokenize to {202, 2026}. Applying the declared predicate
  // is the default; the env var only exists to opt back out.
  it('defaults to on so a declared ilike on a plaintext column is applied as written', () => {
    delete process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS

    expect(resolveSearchConfig().useIlikeForNonEncryptedFields).toBe(true)
  })

  it('can be switched off to restore the legacy rewrite for every column', () => {
    process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS = 'false'

    expect(resolveSearchConfig().useIlikeForNonEncryptedFields).toBe(false)
  })
})

describe('search token limits', () => {
  const variableNames = [
    'OM_SEARCH_MAX_FIELD_CHARS',
    'OM_SEARCH_MAX_TOKENS_PER_FIELD',
    'OM_SEARCH_MAX_TOKENS_PER_RECORD',
  ] as const
  const originalValues = Object.fromEntries(variableNames.map((name) => [name, process.env[name]]))

  afterEach(() => {
    for (const name of variableNames) {
      const original = originalValues[name]
      if (original === undefined) delete process.env[name]
      else process.env[name] = original
    }
  })

  it('uses safe defaults when limits are unset', () => {
    for (const name of variableNames) delete process.env[name]

    expect(resolveSearchTokenLimits(resolveSearchConfig())).toEqual({
      maxFieldChars: DEFAULT_SEARCH_MAX_FIELD_CHARS,
      maxTokensPerField: DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD,
      maxTokensPerRecord: DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD,
    })
  })

  it('accepts zero to disable individual limits', () => {
    for (const name of variableNames) process.env[name] = '0'

    expect(resolveSearchTokenLimits(resolveSearchConfig())).toEqual({
      maxFieldChars: 0,
      maxTokensPerField: 0,
      maxTokensPerRecord: 0,
    })
  })

  it('normalizes invalid custom config values to defaults', () => {
    expect(resolveSearchTokenLimits({
      enabled: true,
      minTokenLength: 3,
      enablePartials: true,
      hashAlgorithm: 'sha256',
      storeRawTokens: false,
      blocklistedFields: [],
      maxFieldChars: Number.NaN,
      maxTokensPerField: -1,
      maxTokensPerRecord: 4.8,
    })).toEqual({
      maxFieldChars: DEFAULT_SEARCH_MAX_FIELD_CHARS,
      maxTokensPerField: DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD,
      maxTokensPerRecord: 4,
    })
  })
})

describe('isSearchFieldBlocklisted', () => {
  const baseConfig = {
    enabled: true,
    minTokenLength: 3,
    enablePartials: true,
    hashAlgorithm: 'sha256' as const,
    storeRawTokens: false,
  }

  it('matches global entries by substring for any entity type', () => {
    const config = { ...baseConfig, blocklistedFields: ['password'], entityBlocklistedFields: {} }
    expect(isSearchFieldBlocklisted('password_hash', 'customers:person', config)).toBe(true)
    expect(isSearchFieldBlocklisted('password_hash', null, config)).toBe(true)
    expect(isSearchFieldBlocklisted('display_name', 'customers:person', config)).toBe(false)
  })

  it('applies an entity-scoped entry only to its own entity type', () => {
    const config = {
      ...baseConfig,
      blocklistedFields: [],
      entityBlocklistedFields: { 'customers:customer_interaction': ['body'] },
    }
    expect(isSearchFieldBlocklisted('body', 'customers:customer_interaction', config)).toBe(true)
    expect(isSearchFieldBlocklisted('body', 'customers:person', config)).toBe(false)
    expect(isSearchFieldBlocklisted('body', null, config)).toBe(false)
  })

  it('compares entity types case-insensitively', () => {
    const config = {
      ...baseConfig,
      blocklistedFields: [],
      entityBlocklistedFields: { 'customers:customer_interaction': ['body'] },
    }
    expect(isSearchFieldBlocklisted('BODY', ' Customers:Customer_Interaction ', config)).toBe(true)
  })

  it('ignores inherited Object.prototype keys when looking up an entity type', () => {
    const config = { ...baseConfig, blocklistedFields: [], entityBlocklistedFields: {} }
    expect(isSearchFieldBlocklisted('body', 'constructor', config)).toBe(false)
    expect(isSearchFieldBlocklisted('body', 'toString', config)).toBe(false)
    expect(isSearchFieldBlocklisted('body', '__proto__', config)).toBe(false)
  })

  it('tolerates a config without the per-entity map', () => {
    const config = { ...baseConfig, blocklistedFields: ['secret'] }
    expect(isSearchFieldBlocklisted('client_secret', 'customers:person', config)).toBe(true)
    expect(isSearchFieldBlocklisted('body', 'customers:person', config)).toBe(false)
  })
})
