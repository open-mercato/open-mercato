import { redactPostgresUrl } from '../runtime-utils'

describe('redactPostgresUrl', () => {
  it('redacts password in a postgres url', () => {
    const redacted = redactPostgresUrl('postgresql://postgres:supersecret@127.0.0.1:5432/demo')
    expect(redacted).toContain('postgres:***@127.0.0.1:5432/demo')
    expect(redacted).not.toContain('supersecret')
  })

  it('preserves url when no password is present', () => {
    const url = 'postgresql://127.0.0.1:5432/demo'
    expect(redactPostgresUrl(url)).toBe(url)
  })

  it('redacts invalid-url fallback format', () => {
    const redacted = redactPostgresUrl('postgres://user:topsecret@db.internal/mydb')
    expect(redacted).toContain('postgres://user:***@db.internal/mydb')
    expect(redacted).not.toContain('topsecret')
  })
})
