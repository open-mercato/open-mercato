import { expoCredentialsSchema } from '../credentials'

describe('expoCredentialsSchema', () => {
  it('accepts credentials with an access token', () => {
    const parsed = expoCredentialsSchema.safeParse({ accessToken: 'expo-access-token' })
    expect(parsed.success).toBe(true)
  })

  it('accepts credentials without the optional access token', () => {
    const parsed = expoCredentialsSchema.safeParse({})
    expect(parsed.success).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(expoCredentialsSchema.safeParse({ accessToken: 123 }).success).toBe(false)
    expect(expoCredentialsSchema.safeParse('not-an-object').success).toBe(false)
  })
})
