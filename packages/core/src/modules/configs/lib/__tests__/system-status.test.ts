import { buildSystemStatusSnapshot } from '../system-status'

function findItemValue(snapshot: ReturnType<typeof buildSystemStatusSnapshot>, key: string): string | null {
  for (const category of snapshot.categories) {
    const item = category.items.find((entry) => entry.key === key)
    if (item) return item.value
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
})
