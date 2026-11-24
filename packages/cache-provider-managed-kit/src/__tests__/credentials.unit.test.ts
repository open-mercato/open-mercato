import { CacheProviderError } from '@open-mercato/cache/provider'
import { createCachedCredentialsProvider, isManagedCredentialUnavailableError, MANAGED_REAUTH_FLOOR_MS } from '../credentials'

const PROVIDER_ID = 'open-mercato/azure-managed-redis'
const OBJECT_ID = '11111111-2222-3333-4444-555555555555'
const provider = { id: PROVIDER_ID }

describe('cached credential refresh scheduling', () => {
  it('reuses a token until expiry minus skew, single-flights concurrent fetches and refetches after', async () => {
    let clock = 1_000_000
    let issued = 0
    const source = jest.fn(async () => {
      issued += 1
      return { username: OBJECT_ID, password: `token-${issued}`, expiresAt: clock + 60 * 60_000 }
    })
    const credentials = createCachedCredentialsProvider(source, { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 5 * 60_000, now: () => clock })
    const [first, second] = await Promise.all([credentials(), credentials()])
    expect(first).toEqual({ username: OBJECT_ID, password: 'token-1' })
    expect(second).toEqual(first)
    expect(source).toHaveBeenCalledTimes(1)
    clock += 54 * 60_000
    expect((await credentials()).password).toBe('token-1')
    clock += 2 * 60_000
    expect((await credentials()).password).toBe('token-2')
    credentials.invalidate()
    expect((await credentials()).password).toBe('token-3')
  })

  it('wraps identity failures in a sanitized unavailable error', async () => {
    const credentials = createCachedCredentialsProvider(async () => {
      throw new Error('AADSTS700016 client secret abc123-secret rejected')
    }, { providerId: provider.id, sourceLabel: 'Microsoft Entra (default)', refreshSkewMs: 0 })
    const failure = await credentials().catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'unavailable', providerId: provider.id })
    expect(`${(failure as Error).message} ${JSON.stringify(failure)}`).not.toContain('abc123-secret')
    expect((failure as Error).message).toContain('Microsoft Entra (default)')
  })

  it('never caches a token without expiry', async () => {
    let issued = 0
    const credentials = createCachedCredentialsProvider(async () => ({ password: `p-${++issued}`, expiresAt: null }), { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })
    expect((await credentials()).password).toBe('p-1')
    expect((await credentials()).password).toBe('p-2')
    await expect(createCachedCredentialsProvider(async () => ({ password: '', expiresAt: null }), { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('schedules the next re-AUTH no later than the moment the token goes stale', async () => {
    let clock = 0
    const credentials = createCachedCredentialsProvider(async () => ({ password: 't', expiresAt: clock + 15 * 60_000 }), { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 5 * 60_000, now: () => clock })
    expect(credentials.nextRefreshDelayMs(30 * 60_000)).toBe(30 * 60_000)
    await credentials()
    expect(credentials.nextRefreshDelayMs(30 * 60_000)).toBe(10 * 60_000)
    expect(credentials.nextRefreshDelayMs(3 * 60_000)).toBe(3 * 60_000)
    clock += 9 * 60_000 + 58_000
    expect(credentials.nextRefreshDelayMs(30 * 60_000)).toBe(MANAGED_REAUTH_FLOOR_MS)
    expect(credentials.nextRefreshDelayMs(750)).toBe(750)
  })

  it('uses the configured interval for tokens without a known expiry', async () => {
    const credentials = createCachedCredentialsProvider(async () => ({ password: 't', expiresAt: null }), { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })
    await credentials()
    expect(credentials.nextRefreshDelayMs(10 * 60_000)).toBe(10 * 60_000)
  })

  it('marks identity-source failures as credential-unavailable, but not settings errors', async () => {
    const wrapped = await createCachedCredentialsProvider(async () => {
      throw new Error('ENOTFOUND metadata.internal')
    }, { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })().catch((error: unknown) => error)
    expect(isManagedCredentialUnavailableError(wrapped)).toBe(true)
    const settingsError = await createCachedCredentialsProvider(async () => {
      throw new CacheProviderError('invalid_settings', 'set auth.objectId', { providerId: provider.id })
    }, { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })().catch((error: unknown) => error)
    expect(isManagedCredentialUnavailableError(settingsError)).toBe(false)
    expect(isManagedCredentialUnavailableError(new Error('x'))).toBe(false)
  })
})
