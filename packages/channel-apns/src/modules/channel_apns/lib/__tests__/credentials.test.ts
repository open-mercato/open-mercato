import { apnsCredentialsSchema, resolveApnsCredentials } from '../credentials'
import { APNS_TEST_P8_KEY } from './apnsTestKey'
import {
  PUSH_CREDENTIAL_ERROR_INVALID_BUNDLE_ID,
  PUSH_CREDENTIAL_ERROR_INVALID_KEY_ID,
  PUSH_CREDENTIAL_ERROR_INVALID_P8,
  PUSH_CREDENTIAL_ERROR_INVALID_TEAM_ID,
} from '@open-mercato/core/modules/communication_channels/lib/push-credential-errors'

const validCredentials = {
  p8Key: APNS_TEST_P8_KEY,
  keyId: 'ABC123DEFG',
  teamId: 'TEAM123456',
  bundleId: 'com.demo.app',
}

function firstIssueMessage(input: unknown): string | undefined {
  const parsed = apnsCredentialsSchema.safeParse(input)
  return parsed.success ? undefined : parsed.error.issues[0]?.message
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

  // Regression: a non-empty but unparseable `.p8` used to pass validation, so the
  // channel connected and showed as Active while being unable to deliver anything.
  it('rejects a p8Key that is not a parseable private key', () => {
    expect(
      firstIssueMessage({ ...validCredentials, p8Key: 'obviously-not-a-key' }),
    ).toBe(PUSH_CREDENTIAL_ERROR_INVALID_P8)
    expect(
      firstIssueMessage({
        ...validCredentials,
        p8Key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
      }),
    ).toBe(PUSH_CREDENTIAL_ERROR_INVALID_P8)
  })

  it('rejects Apple identifiers that are not 10 alphanumeric characters', () => {
    expect(firstIssueMessage({ ...validCredentials, keyId: 'SHORT' })).toBe(
      PUSH_CREDENTIAL_ERROR_INVALID_KEY_ID,
    )
    expect(firstIssueMessage({ ...validCredentials, teamId: 'WAY-TOO-LONG-1' })).toBe(
      PUSH_CREDENTIAL_ERROR_INVALID_TEAM_ID,
    )
  })

  it('rejects a bundleId that is not reverse-DNS', () => {
    expect(firstIssueMessage({ ...validCredentials, bundleId: 'notreversedns' })).toBe(
      PUSH_CREDENTIAL_ERROR_INVALID_BUNDLE_ID,
    )
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
