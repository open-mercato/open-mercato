import {
  resolveRegisteredEntityTableName,
  resolveEntityTableName,
  isValidEntityIdShape,
  ENTITY_ID_PATTERN,
} from '../engine'

// MikroORM v7's real MetadataStorage.getAll() returns a Map, not an array (#6725,
// same getAll()-returns-a-Map class of bug as #5579). A plain-array double here
// would let the secondary lookup's broken `for...of` iteration pass trivially.
function makeEm(metaByClass: Record<string, string>) {
  const all = new Map(
    Object.entries(metaByClass).map(([className, tableName]) => [className, { className, tableName }]),
  )
  return {
    getMetadata: () => ({
      find: (className: string) => {
        const tableName = metaByClass[className]
        return tableName ? { tableName } : undefined
      },
      getAll: () => all,
    }),
  } as any
}

describe('resolveRegisteredEntityTableName', () => {
  it('resolves a registered entity via class-name metadata', () => {
    const em = makeEm({ Todo: 'todos' })
    expect(resolveRegisteredEntityTableName(em, 'example:todo')).toBe('todos')
  })

  it('resolves a registered entity via the secondary table-name lookup', () => {
    const em = makeEm({ SomeOtherClass: 'directory_organizations' })
    expect(resolveRegisteredEntityTableName(em, 'directory:organization')).toBe('directory_organizations')
  })

  it('returns null for an entity type that does not map to any registered metadata', () => {
    const em = makeEm({ Todo: 'todos' })
    expect(resolveRegisteredEntityTableName(em, 'foo:auth_user')).toBeNull()
    expect(resolveRegisteredEntityTableName(em, 'foo:user')).toBeNull()
  })

  it('returns null when no metadata is available', () => {
    expect(resolveRegisteredEntityTableName(undefined, 'example:todo')).toBeNull()
    expect(resolveRegisteredEntityTableName({} as any, 'example:todo')).toBeNull()
  })

  it('never pluralizes attacker-chosen ids into a real table name', () => {
    const em = makeEm({})
    expect(resolveRegisteredEntityTableName(em, 'foo:auth_user')).toBeNull()
    expect(resolveRegisteredEntityTableName(em, 'foo:user')).toBeNull()
  })

  it('the secondary lookup actually scans metadata on a real MikroORM 7 MetadataStorage (#6725)', () => {
    // getMetadata().getAll() returns a Map keyed by class, not an array, so a
    // registered entity whose class name does not match any PascalCase candidate
    // (step 1 misses) must still be found by the table-name scan (step 2).
    const em = makeEm({ SomeUnrelatedClassName: 'directory_organizations' })
    expect(resolveRegisteredEntityTableName(em, 'directory:organization')).toBe('directory_organizations')
  })

  it('the secondary lookup does not match an unregistered id to an unrelated table', () => {
    const em = makeEm({ Invoice: 'sales_invoices' })
    expect(resolveRegisteredEntityTableName(em, 'clinic:patient')).toBeNull()
  })
})

describe('resolveEntityTableName fallback (broad query path)', () => {
  it('still falls back to a pluralized guess for unregistered ids', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const em = makeEm({})
      expect(resolveEntityTableName(em, 'foo:never_registered_widget')).toBe('never_registered_widgets')
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('isValidEntityIdShape', () => {
  it('accepts canonical module:entity ids', () => {
    expect(isValidEntityIdShape('example:todo')).toBe(true)
    expect(isValidEntityIdShape('directory:organization')).toBe(true)
    expect(isValidEntityIdShape('query_index:search_token')).toBe(true)
  })

  it('rejects ids without exactly two snake_case segments', () => {
    expect(isValidEntityIdShape('todos')).toBe(false)
    expect(isValidEntityIdShape('auth_users')).toBe(false)
    expect(isValidEntityIdShape('foo:bar:baz')).toBe(false)
    expect(isValidEntityIdShape('Foo:Bar')).toBe(false)
    expect(isValidEntityIdShape('1bad:entity')).toBe(false)
    expect(isValidEntityIdShape('foo:')).toBe(false)
    expect(isValidEntityIdShape(':bar')).toBe(false)
    expect(isValidEntityIdShape('foo bar:baz')).toBe(false)
  })

  it('exposes the pattern for schema reuse', () => {
    expect(ENTITY_ID_PATTERN.test('example:todo')).toBe(true)
  })
})
