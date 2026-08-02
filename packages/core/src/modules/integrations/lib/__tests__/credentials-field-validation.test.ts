/** @jest-environment node */

import type { IntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'
import {
  collectCredentialUrlValidationErrors,
  isValidCredentialUrl,
} from '../credentials-field-validation'

describe('isValidCredentialUrl', () => {
  it('accepts valid http(s) URLs', () => {
    expect(isValidCredentialUrl('https://your-instance.cloud.akeneo.com')).toBe(true)
    expect(isValidCredentialUrl('http://example.com')).toBe(true)
    expect(isValidCredentialUrl('https://example.com:8443/path?query=1')).toBe(true)
  })

  it('rejects script fragments and malformed URLs from the bug report', () => {
    expect(isValidCredentialUrl('<script>alert(1)</script>')).toBe(false)
    expect(isValidCredentialUrl('http://example.com<script>alert(1)</script>')).toBe(false)
  })

  it('rejects arbitrary text and non-http protocols', () => {
    expect(isValidCredentialUrl('not a url')).toBe(false)
    expect(isValidCredentialUrl('example.com')).toBe(false)
    expect(isValidCredentialUrl('javascript:alert(1)')).toBe(false)
    expect(isValidCredentialUrl('ftp://example.com')).toBe(false)
    expect(isValidCredentialUrl('')).toBe(false)
  })

  it('rejects URLs containing embedded credentials', () => {
    expect(isValidCredentialUrl('https://user:token@example.com/path')).toBe(false)
    expect(isValidCredentialUrl('https://user@example.com/path')).toBe(false)
  })
})

describe('collectCredentialUrlValidationErrors', () => {
  const schema: IntegrationCredentialsSchema = {
    fields: [
      { key: 'apiUrl', label: 'Akeneo URL', type: 'url', required: true },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
    ],
  }

  it('flags an invalid url field with a field-keyed message', () => {
    const errors = collectCredentialUrlValidationErrors(schema, {
      apiUrl: '<script>alert(1)</script>',
      clientId: 'abc',
      clientSecret: 'def',
    })
    expect(errors).toEqual({ apiUrl: 'Akeneo URL must be a valid http(s) URL.' })
  })

  it('returns no errors for a valid url', () => {
    const errors = collectCredentialUrlValidationErrors(schema, {
      apiUrl: 'https://your-instance.cloud.akeneo.com',
      clientId: 'abc',
    })
    expect(errors).toEqual({})
  })

  it('skips empty/absent url values (required-ness is enforced elsewhere)', () => {
    expect(collectCredentialUrlValidationErrors(schema, { apiUrl: '' })).toEqual({})
    expect(collectCredentialUrlValidationErrors(schema, { apiUrl: '   ' })).toEqual({})
    expect(collectCredentialUrlValidationErrors(schema, {})).toEqual({})
  })

  it('does not validate non-url field types as URLs', () => {
    const errors = collectCredentialUrlValidationErrors(schema, {
      clientId: 'not-a-url',
      clientSecret: '<script>alert(1)</script>',
    })
    expect(errors).toEqual({})
  })

  it('supports a custom message builder', () => {
    const errors = collectCredentialUrlValidationErrors(
      schema,
      { apiUrl: 'broken' },
      (field) => `bad:${field.key}`,
    )
    expect(errors).toEqual({ apiUrl: 'bad:apiUrl' })
  })

  it('returns no errors when the schema is undefined', () => {
    expect(collectCredentialUrlValidationErrors(undefined, { apiUrl: 'broken' })).toEqual({})
  })
})
