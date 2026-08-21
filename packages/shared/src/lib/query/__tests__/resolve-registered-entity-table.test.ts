import {
  resolveRegisteredEntityTableName,
  resolveEntityTableName,
  isValidEntityIdShape,
  ENTITY_ID_PATTERN,
} from '../engine'

function makeEm(metaByClass: Record<string, string>) {
  const all = Object.entries(metaByClass).map(([className, tableName]) => ({ className, tableName }))
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
