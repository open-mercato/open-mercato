import { resolveCacheProvider, defineCacheProviderRegistration } from '@open-mercato/cache/provider'
import { buildRespKeyLayout } from '@open-mercato/cache-redis-protocol'
import { KEYDB_CACHE_PROVIDER_ID, provider, settings } from '../index'

describe('keydb cache provider definition', () => {
  it('declares a namespaced first-party id and shared placement', () => {
    expect(provider.id).toBe(KEYDB_CACHE_PROVIDER_ID)
    expect(provider.id).toBe('open-mercato/keydb')
    expect(provider.apiVersion).toBe(1)
    expect(provider.capability(settings.parse({ host: 'h' }))).toEqual({ placement: 'shared' })
  })

  it('accepts only the standalone profile with strict keys', () => {
    expect(settings.safeParse({ host: 'h', port: 6380, username: 'u', password: 'p', tls: {} }).success).toBe(true)
    expect(settings.safeParse({ mode: 'cluster', nodes: [{ host: 'h' }] }).success).toBe(false)
    expect(settings.safeParse({ host: 'h', endpoints: ['h:1'] }).success).toBe(false)
    expect(settings.safeParse({}).success).toBe(false)
  })

  it('reports invalid settings through the host with field paths only', async () => {
    const registration = defineCacheProviderRegistration({
      id: provider.id,
      load: async () => provider,
      settings: () => ({ host: '', password: 'never-in-errors', extra: 1 }),
    })
    const failure = await resolveCacheProvider([registration], {
      env: { CACHE_PROVIDER: provider.id, CACHE_PROVIDER_NAMESPACE: 'unit' },
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'invalid_settings', fieldPaths: expect.arrayContaining(['host']) })
    expect(JSON.stringify(failure)).not.toContain('never-in-errors')
    expect(String((failure as Error).message)).not.toContain('never-in-errors')
  })

  it('redacts credentials and TLS key material', () => {
    const redacted = JSON.stringify(provider.redact?.(settings.parse({
      host: 'cache.internal',
      username: 'svc-user',
      password: 'svc-secret',
      tls: { ca: 'CA-PEM', cert: 'CERT-PEM', key: 'KEY-PEM' },
    })))
    for (const secret of ['svc-user', 'svc-secret', 'CA-PEM', 'CERT-PEM', 'KEY-PEM']) expect(redacted).not.toContain(secret)
    expect(redacted).toContain('cache.internal')
  })

  it('fences physical keys into the deployment namespace hash tag', () => {
    const layout = buildRespKeyLayout('deploy-1')
    expect(layout.valueKey('tenant:t:key:k:x')).toBe('om:{deploy-1}:v:tenant:t:key:k:x')
  })
})
