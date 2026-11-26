import { resolveMfaRequestContext } from '../_shared'
import { GET } from '../methods/route'

jest.mock('../_shared', () => ({
  mapMfaError: jest.fn((error: unknown) => { throw error }),
  resolveMfaRequestContext: jest.fn(),
}))

test('returns public metadata without the legacy TOTP seed', async () => {
  const legacyMetadata = { secret: 'synthetic-legacy-seed', label: 'Authenticator' }
  const passkeyMetadata = { credentialId: 'device-identifier', label: 'Security key' }
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const getUserMethods = jest.fn(async () => [
    { id: 'legacy-method', type: 'totp', providerMetadata: legacyMetadata, createdAt },
    { id: 'passkey-method', type: 'passkey', providerMetadata: passkeyMetadata, createdAt },
    { id: 'current-method', type: 'totp', providerMetadata: null, createdAt },
  ])
  jest.mocked(resolveMfaRequestContext).mockResolvedValue({
    auth: { sub: 'account' },
    mfaService: { getUserMethods },
  } as Awaited<ReturnType<typeof resolveMfaRequestContext>>)

  const response = await GET(new Request('https://example.test/api/security/mfa/methods'))

  expect(response.status).toBe(200)
  expect(getUserMethods).toHaveBeenCalledWith('account')
  const body = await response.json() as { methods: { providerMetadata: unknown }[] }
  expect(body.methods.map((method) => method.providerMetadata)).toEqual([
    { label: 'Authenticator' },
    passkeyMetadata,
    null,
  ])
  expect(legacyMetadata.secret).toBe('synthetic-legacy-seed')
})
