import { normalizeCompanyProfilePayload } from '../companies/payload'
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

describe('normalizeCompanyProfilePayload (companies)', () => {
  it('returns payload unchanged when no profile key is present', () => {
    const payload = { id: 'c1', legalName: 'Acme Inc' }
    const result = normalizeCompanyProfilePayload(payload, translate)
    expect(result).toEqual(payload)
  })

  it('lifts nested profile.legalName to top level', () => {
    const payload = {
      id: 'c1',
      profile: { legalName: 'Acme Inc' },
    }
    const result = normalizeCompanyProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'c1', legalName: 'Acme Inc' })
    expect(result).not.toHaveProperty('profile')
  })

  it('lifts all supported company profile fields', () => {
    const profileFields = {
      legalName: 'Acme Inc',
      brandName: 'Acme',
      domain: 'acme.example.com',
      websiteUrl: 'https://acme.example.com',
      industry: 'Technology',
      sizeBucket: '51-200',
      annualRevenue: 5000000,
    }
    const payload = { id: 'c1', profile: profileFields }
    const result = normalizeCompanyProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'c1', ...profileFields })
  })

  it('top-level value wins over nested value', () => {
    const payload = {
      id: 'c1',
      legalName: 'Top Level Corp',
      profile: { legalName: 'Nested Corp' },
    }
    const result = normalizeCompanyProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'c1', legalName: 'Top Level Corp' })
  })

  it('ignores round-trip keys (id, updatedAt) inside profile', () => {
    const payload = {
      id: 'c1',
      profile: {
        id: 'profile-id',
        updatedAt: '2026-01-01T00:00:00Z',
        legalName: 'Acme Inc',
      },
    }
    const result = normalizeCompanyProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'c1', legalName: 'Acme Inc' })
  })

  it('throws 400 for non-object profile (string)', () => {
    const payload = { id: 'c1', profile: 'abc' }
    expect(() => normalizeCompanyProfilePayload(payload, translate)).toThrow(CrudHttpError)
    try {
      normalizeCompanyProfilePayload(payload, translate)
    } catch (error) {
      expect((error as CrudHttpError).status).toBe(400)
      expect((error as CrudHttpError).body).toEqual({
        error: 'profile must be an object',
      })
    }
  })

  it('throws 400 for non-object profile (number)', () => {
    const payload = { id: 'c1', profile: 42 }
    expect(() => normalizeCompanyProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('throws 400 for non-object profile (null)', () => {
    const payload = { id: 'c1', profile: null }
    expect(() => normalizeCompanyProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('throws 400 for non-object profile (array)', () => {
    const payload = { id: 'c1', profile: [1, 2] }
    expect(() => normalizeCompanyProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('throws 400 for unsupported nested profile key', () => {
    const payload = { id: 'c1', profile: { favoriteColor: 'red' } }
    expect(() => normalizeCompanyProfilePayload(payload, translate)).toThrow(CrudHttpError)
    try {
      normalizeCompanyProfilePayload(payload, translate)
    } catch (error) {
      expect((error as CrudHttpError).status).toBe(400)
      expect((error as CrudHttpError).body).toEqual({
        error: 'Unsupported profile field: favoriteColor',
      })
    }
  })

  it('throws 400 for person-specific field in company profile', () => {
    const payload = { id: 'c1', profile: { linkedInUrl: 'https://linkedin.example.com/in/person' } }
    expect(() => normalizeCompanyProfilePayload(payload, translate)).toThrow(CrudHttpError)
  })

  it('handles empty profile object (no keys to lift)', () => {
    const payload = { id: 'c1', profile: {} }
    const result = normalizeCompanyProfilePayload(payload, translate)
    expect(result).toEqual({ id: 'c1' })
  })
})
