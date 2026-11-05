import { normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'

describe('normalizeAuthorUserId', () => {
  const validUuid = 'a1b2c3d4-e5f6-1a2b-9c3d-4e5f6a7b8c9d'

  it('ignores explicit authorUserId for normal authenticated callers', () => {
    const spoofedUuid = 'b1b2c3d4-e5f6-1a2b-9c3d-4e5f6a7b8c9d'

    expect(normalizeAuthorUserId(spoofedUuid, { sub: validUuid })).toBe(validUuid)
  })

  it('honors explicit authorUserId for super admins', () => {
    const delegatedUuid = 'b1b2c3d4-e5f6-1a2b-9c3d-4e5f6a7b8c9d'

    expect(normalizeAuthorUserId(delegatedUuid, { sub: validUuid, isSuperAdmin: true })).toBe(delegatedUuid)
  })

  it('rejects non-UUID explicit authorUserId values for super admins', () => {
    expect(normalizeAuthorUserId('not-a-uuid', { sub: validUuid, isSuperAdmin: true })).toBe(validUuid)
  })

  it('returns null when no explicit ID and auth is null', () => {
    expect(normalizeAuthorUserId(null, null)).toBeNull()
  })

  it('returns null when no explicit ID and auth is undefined', () => {
    expect(normalizeAuthorUserId(undefined, undefined)).toBeNull()
  })

  it('returns null when auth.isApiKey is true', () => {
    expect(normalizeAuthorUserId(null, { isApiKey: true, sub: validUuid })).toBeNull()
  })

  it('returns auth.sub when it is a valid UUID', () => {
    expect(normalizeAuthorUserId(null, { sub: validUuid })).toBe(validUuid)
  })

  it('returns null when auth.sub is not a valid UUID', () => {
    expect(normalizeAuthorUserId(null, { sub: 'some-string' })).toBeNull()
  })

  it('returns null when auth.sub is an email', () => {
    expect(normalizeAuthorUserId(null, { sub: 'user@example.com' })).toBeNull()
  })

  it('returns null when auth.sub is null', () => {
    expect(normalizeAuthorUserId(null, { sub: null })).toBeNull()
  })

  it('returns null when auth.sub is undefined', () => {
    expect(normalizeAuthorUserId(null, { sub: undefined })).toBeNull()
  })
})
