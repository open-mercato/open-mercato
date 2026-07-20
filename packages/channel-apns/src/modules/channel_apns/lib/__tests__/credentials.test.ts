import { apnsCredentialsSchema, resolveApnsCredentials } from '../credentials'

const validCredentials = {
  p8Key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  keyId: 'ABC123DEFG',
  teamId: 'TEAM123456',
  bundleId: 'com.demo.app',
}

describe('apnsCredentialsSchema', () => {
  it('accepts well-formed credentials', () => {
    const parsed = apnsCredentialsSchema.safeParse({ ...validCredentials, production: true })
    expect(parsed.success).toBe(true)
  })

  it('accepts credentials without the optional production flag', () => {
    const parsed = apnsCredentialsSchema.safeParse(validCredentials)
    expect(parsed.success).toBe(true)
  })

  it('rejects when a required field is missing', () => {
    const { p8Key, ...withoutKey } = validCredentials
    expect(apnsCredentialsSchema.safeParse(withoutKey).success).toBe(false)
    expect(apnsCredentialsSchema.safeParse({ ...validCredentials, keyId: '' }).success).toBe(false)
    expect(apnsCredentialsSchema.safeParse({ ...validCredentials, teamId: '' }).success).toBe(false)
    expect(apnsCredentialsSchema.safeParse({ ...validCredentials, bundleId: '' }).success).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(apnsCredentialsSchema.safeParse({ p8Key: 123 }).success).toBe(false)
    expect(apnsCredentialsSchema.safeParse('not-an-object').success).toBe(false)
  })
})

describe('resolveApnsCredentials', () => {
  it('passes through the strongly-typed send config', () => {
    const resolved = resolveApnsCredentials({ ...validCredentials, production: true })
    expect(resolved.p8Key).toBe(validCredentials.p8Key)
    expect(resolved.keyId).toBe(validCredentials.keyId)
    expect(resolved.teamId).toBe(validCredentials.teamId)
    expect(resolved.bundleId).toBe(validCredentials.bundleId)
  })

  it('keeps boolean production flags verbatim', () => {
    expect(resolveApnsCredentials({ ...validCredentials, production: true }).production).toBe(true)
    expect(resolveApnsCredentials({ ...validCredentials, production: false }).production).toBe(false)
  })

  it('coerces string production flags via parseBooleanWithDefault', () => {
    expect(resolveApnsCredentials({ ...validCredentials, production: 'true' }).production).toBe(true)
    expect(resolveApnsCredentials({ ...validCredentials, production: 'false' }).production).toBe(false)
  })

  it('defaults production to false when omitted', () => {
    expect(resolveApnsCredentials(validCredentials).production).toBe(false)
  })
})
