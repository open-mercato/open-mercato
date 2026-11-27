import { buildSystemStatusSnapshot } from '../system-status'

function findItemValue(snapshot: ReturnType<typeof buildSystemStatusSnapshot>, key: string): string | null {
  for (const category of snapshot.categories) {
    const item = category.items.find((entry) => entry.key === key)
    if (item) return item.value
  }
  return null
}

function findItem(snapshot: ReturnType<typeof buildSystemStatusSnapshot>, key: string) {
  for (const category of snapshot.categories) {
    const item = category.items.find((entry) => entry.key === key)
    if (item) return item
  }
  return null
}

describe('buildSystemStatusSnapshot', () => {
  it('masks credentials for DATABASE_URL', () => {
    const snapshot = buildSystemStatusSnapshot({
      DATABASE_URL: 'postgresql://app_user:secret@db.example.com:5432/mercato?sslmode=require',
    })

    const value = findItemValue(snapshot, 'DATABASE_URL')
    expect(value).toBe('postgresql://db.example.com:5432/mercato?sslmode=require')
    expect(value).not.toContain('app_user')
    expect(value).not.toContain('secret')
  })

  it('keeps database url unchanged when no credentials are present', () => {
    const snapshot = buildSystemStatusSnapshot({
      DATABASE_URL: 'postgresql://db.example.com:5432/mercato',
    })

    expect(findItemValue(snapshot, 'DATABASE_URL')).toBe('postgresql://db.example.com:5432/mercato')
  })

  it('masks credentials for malformed DSNs using fallback redaction', () => {
    const cases = [
      {
        input: 'postgresql://app_user:se/cret@db.example.com:5432/mercato',
        expected: 'postgresql://db.example.com:5432/mercato',
      },
      {
        input: 'postgresql://app_user:secret@/mercato',
        expected: 'postgresql:///mercato',
      },
      {
        input: 'postgresql://app_user:secret@db.example.com:5432/mercato?sslmode=require',
        expected: 'postgresql://db.example.com:5432/mercato?sslmode=require',
      },
    ]

    for (const entry of cases) {
      const snapshot = buildSystemStatusSnapshot({ DATABASE_URL: entry.input })
      const value = findItemValue(snapshot, 'DATABASE_URL')
      expect(value).toBe(entry.expected)
      expect(value).not.toContain('app_user')
      expect(value).not.toContain('secret')
    }
  })

  it('surfaces the sqlite cache default under .mercato', () => {
    const snapshot = buildSystemStatusSnapshot({})

    expect(findItem(snapshot, 'CACHE_SQLITE_PATH')?.defaultValue).toBe('./.mercato/cache/cache.db')
  })

  it('lists the cache provider selection next to the cache strategy', () => {
    const snapshot = buildSystemStatusSnapshot({ CACHE_PROVIDER: 'acme/shared', CACHE_PROVIDER_NAMESPACE: 'deploy-1' })
    const caching = snapshot.categories.find((category) => category.items.some((item) => item.key === 'CACHE_STRATEGY'))
    const keys = caching?.items.map((item) => item.key) ?? []
    expect(keys.slice(keys.indexOf('CACHE_STRATEGY'), keys.indexOf('CACHE_STRATEGY') + 3)).toEqual([
      'CACHE_STRATEGY',
      'CACHE_PROVIDER',
      'CACHE_PROVIDER_NAMESPACE',
    ])
    expect(findItemValue(snapshot, 'CACHE_PROVIDER')).toBe('acme/shared')
    expect(findItemValue(snapshot, 'CACHE_PROVIDER_NAMESPACE')).toBe('deploy-1')
  })
})
