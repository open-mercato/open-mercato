import { infinispanSettingsSchema, redactInfinispanSettings } from '../settings'

const minimal = {
  servers: [{ host: 'ispn-1.internal' }],
  cacheName: 'open-mercato',
  auth: { username: 'svc-cache', password: 'super-secret-password' },
}

describe('infinispan settings schema', () => {
  it('applies defaults for the first supported profile', () => {
    const parsed = infinispanSettingsSchema.parse(minimal)
    expect(parsed).toMatchObject({
      servers: [{ host: 'ispn-1.internal', port: 11222 }],
      auth: { mechanism: 'SCRAM-SHA-256' },
      protocolVersion: '4.1',
      topologyUpdates: true,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 5000,
      iteratorBatchSize: 256,
      tagIndexShards: 16,
      indexPruneGraceMs: 120000,
    })
    expect(parsed.tls).toBeUndefined()
  })

  it('rejects unknown keys at every level', () => {
    const result = infinispanSettingsSchema.safeParse({
      ...minimal,
      extra: true,
      auth: { ...minimal.auth, realm: 'default' },
      servers: [{ host: 'a', port: 1, weight: 2 }],
    })
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['', 'auth', 'servers.0']))
  })

  it('requires authentication and refuses unverified profiles', () => {
    expect(infinispanSettingsSchema.safeParse({ servers: minimal.servers, cacheName: 'c' }).success).toBe(false)
    expect(infinispanSettingsSchema.safeParse({ ...minimal, auth: { ...minimal.auth, mechanism: 'PLAIN' } }).success).toBe(false)
    expect(infinispanSettingsSchema.safeParse({ ...minimal, protocolVersion: 'auto' }).success).toBe(false)
    expect(infinispanSettingsSchema.safeParse({ ...minimal, servers: [] }).success).toBe(false)
  })

  it('validates TLS trust files and the prune grace window', () => {
    expect(infinispanSettingsSchema.safeParse({ ...minimal, tls: { enabled: true, caFiles: ['relative.pem'] } }).success).toBe(false)
    expect(infinispanSettingsSchema.safeParse({ ...minimal, tls: { enabled: true, caFiles: ['/etc/ssl/ispn-ca.pem'], serverName: 'ispn.local' } }).success).toBe(true)
    const tooShort = infinispanSettingsSchema.safeParse({ ...minimal, commandTimeoutMs: 10_000, indexPruneGraceMs: 20_000 })
    expect(tooShort.success).toBe(false)
    expect(tooShort.success ? [] : tooShort.error.issues.map((issue) => issue.path.join('.'))).toEqual(['indexPruneGraceMs'])
  })

  it('redacts credentials and endpoints', () => {
    const redacted = redactInfinispanSettings(infinispanSettingsSchema.parse({ ...minimal, tls: { enabled: true, caFiles: ['/ca.pem'] } }))
    const serialized = JSON.stringify(redacted)
    expect(serialized).not.toContain('super-secret-password')
    expect(serialized).not.toContain('svc-cache')
    expect(serialized).not.toContain('ispn-1.internal')
    expect(serialized).not.toContain('/ca.pem')
    expect(redacted).toMatchObject({ servers: 1, cacheName: 'open-mercato', auth: { mechanism: 'SCRAM-SHA-256' }, tls: { enabled: true, caFiles: 1 } })
  })
})
