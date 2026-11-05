import { normalizeProfilePayload } from '../people/payload'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const translate = (key: string, fallback?: string, params?: Record<string, string>) => {
  let result = fallback ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{{${k}}}`, v)
    }
  }
  return result
}

describe('normalizeProfilePayload (people)', () => {
  it('returns payload unchanged when no profile key is present', () => {
    const payload = { id: 'p1', linkedInUrl: 'https://linkedin.example.com/in/flat' }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual(payload)
  })

  it('lifts nested profile.linkedInUrl to top level', () => {
    const payload = {
      id: 'p1',
      profile: { linkedInUrl: 'https://linkedin.example.com/in/nested' },
    }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({
      id: 'p1',
      linkedInUrl: 'https://linkedin.example.com/in/nested',
    })
    expect(result).not.toHaveProperty('profile')
  })

  it('lifts nested profile.timezone to top level', () => {
    const payload = {
      id: 'p1',
      profile: { timezone: 'Europe/Warsaw' },
    }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'p1', timezone: 'Europe/Warsaw' })
  })

  it('lifts all supported person profile fields', () => {
    const profileFields = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      preferredName: 'Ada L.',
      jobTitle: 'Engineer',
      department: 'R&D',
      seniority: 'Senior',
      timezone: 'UTC',
      linkedInUrl: 'https://linkedin.example.com/in/ada',
      twitterUrl: 'https://twitter.example.com/ada',
      companyEntityId: 'c1',
    }
    const payload = { id: 'p1', profile: profileFields }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'p1', ...profileFields })
  })

  it('top-level value wins over nested value', () => {
    const payload = {
      id: 'p1',
      linkedInUrl: 'https://linkedin.example.com/in/top-level',
      profile: { linkedInUrl: 'https://linkedin.example.com/in/nested' },
    }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({
      id: 'p1',
      linkedInUrl: 'https://linkedin.example.com/in/top-level',
    })
  })

  it('ignores round-trip keys (id, updatedAt) inside profile', () => {
    const payload = {
      id: 'p1',
      profile: {
        id: 'profile-id',
        updatedAt: '2026-01-01T00:00:00Z',
        linkedInUrl: 'https://linkedin.example.com/in/nested',
      },
    }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({
      id: 'p1',
      linkedInUrl: 'https://linkedin.example.com/in/nested',
    })
  })

  it('throws 400 for non-object profile (string)', () => {
    const payload = { id: 'p1', profile: 'abc' }
    expect(() => normalizeProfilePayload(payload, translate)).toThrow(CrudHttpError)
    try {
      normalizeProfilePayload(payload, translate)
    } catch (error) {
      expect((error as CrudHttpError).status).toBe(400)
      expect((error as CrudHttpError).body).toEqual({
        error: 'profile must be an object',
      })
    }
  })

  it('throws 400 for non-object profile (number)', () => {
    const payload = { id: 'p1', profile: 123 }
    expect(() => normalizeProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('throws 400 for non-object profile (null)', () => {
    const payload = { id: 'p1', profile: null }
    expect(() => normalizeProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('throws 400 for non-object profile (array)', () => {
    const payload = { id: 'p1', profile: ['a', 'b'] }
    expect(() => normalizeProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('throws 400 for unsupported nested profile key', () => {
    const payload = { id: 'p1', profile: { favoriteColor: 'blue' } }
    expect(() => normalizeProfilePayload(payload, translate)).toThrow(CrudHttpError)
    try {
      normalizeProfilePayload(payload, translate)
    } catch (error) {
      expect((error as CrudHttpError).status).toBe(400)
      expect((error as CrudHttpError).body).toEqual({
        error: 'Unsupported profile field: favoriteColor',
      })
    }
  })

  it('throws 400 for mixed supported and unsupported nested keys', () => {
    const payload = {
      id: 'p1',
      profile: { linkedInUrl: 'https://linkedin.example.com/in/ok', badField: 'nope' },
    }
    expect(() => normalizeProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('returns payload unchanged when profile is undefined', () => {
    const payload = { id: 'p1', profile: undefined }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'p1', profile: undefined })
  })

  it('handles empty profile object (no keys to lift)', () => {
    const payload = { id: 'p1', profile: {} }
    const result = normalizeProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'p1' })
  })
})
