import {
  ssoConfigAdminCreateSchema,
  ssoConfigAdminUpdateSchema,
} from '../validators'

describe('SSO config assurance validation', () => {
  const baseCreate = {
    name: 'Company OIDC',
    protocol: 'oidc' as const,
    issuer: 'https://idp.example.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  }

  test('normalizes and deduplicates configured ACR and AMR values', () => {
    const parsed = ssoConfigAdminCreateSchema.parse({
      ...baseCreate,
      ssoRequired: true,
      requiredAcrValues: [' urn:example:loa:2 ', 'urn:example:loa:2'],
      requiredAmrValues: ['pwd', ' otp ', 'pwd'],
    })

    expect(parsed).toMatchObject({
      ssoRequired: true,
      requiredAcrValues: ['urn:example:loa:2'],
      requiredAmrValues: ['pwd', 'otp'],
    })
  })

  test('defaults assurance requirements to disabled', () => {
    const parsed = ssoConfigAdminCreateSchema.parse(baseCreate)

    expect(parsed.ssoRequired).toBe(false)
    expect(parsed.requiredAcrValues).toEqual([])
    expect(parsed.requiredAmrValues).toEqual([])
  })

  test('rejects more than twenty configured values', () => {
    const parsed = ssoConfigAdminUpdateSchema.safeParse({
      requiredAmrValues: Array.from({ length: 21 }, (_, index) => `method-${index}`),
    })

    expect(parsed.success).toBe(false)
  })
})
