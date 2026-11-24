import { createHash } from 'node:crypto'
import {
  buildRespKeyLayout,
  createRespSettingsSchema,
  createRespStandaloneSettingsSchema,
  DELETE_IF_UNCHANGED,
  escapeRespGlob,
  literalPatternPrefix,
  parseRespServerInfo,
  REAP_TAG_MEMBERS,
  redactRespSettings,
  respReconnectDelay,
} from '../index'

describe('RESP key layout', () => {
  it('hash-tags every key of a namespace into one slot', () => {
    const layout = buildRespKeyLayout('prod-eu.1')
    expect(layout.prefix).toBe('om:{prod-eu.1}:')
    expect(layout.valueKey('tenant:a:key:k:x')).toBe('om:{prod-eu.1}:v:tenant:a:key:k:x')
    expect(layout.tagKey('tenant:a:tag:t')).toBe('om:{prod-eu.1}:t:tenant:a:tag:t')
    expect(layout.physicalKeyFromValueKey('om:{prod-eu.1}:v:k{1}')).toBe('k{1}')
    expect(layout.physicalKeyFromValueKey('om:{other}:v:k')).toBeNull()
  })

  it('keeps physical keys with braces from changing the hash slot', () => {
    const layout = buildRespKeyLayout('ns')
    const key = layout.valueKey('{evil}:key')
    expect(key.indexOf('{')).toBe(layout.prefix.indexOf('{'))
    expect(key.slice(key.indexOf('{') + 1, key.indexOf('}'))).toBe('ns')
  })

  it('builds SCAN patterns from the literal prefix with glob characters escaped', () => {
    const layout = buildRespKeyLayout('ns')
    expect(literalPatternPrefix('tenant:*:key:meta:*')).toBe('tenant:')
    expect(literalPatternPrefix('user:?')).toBe('user:')
    expect(literalPatternPrefix(undefined)).toBe('')
    expect(escapeRespGlob('a*b?c[d]e\\')).toBe('a\\*b\\?c\\[d\\]e\\\\')
    expect(layout.valueScanPattern()).toBe('om:{ns}:v:*')
    expect(layout.valueScanPattern('tenant:[x]*')).toBe('om:{ns}:v:tenant:\\[x\\]*')
    expect(layout.tagScanPattern()).toBe('om:{ns}:t:*')
  })

  it('rejects namespaces that could escape the hash tag or glob', () => {
    for (const namespace of ['', 'a}b', 'a{b', 'a*', 'a:b', 'x'.repeat(65)]) {
      expect(() => buildRespKeyLayout(namespace)).toThrow()
    }
  })
})

describe('RESP settings schema', () => {
  const standalone = createRespStandaloneSettingsSchema()

  it('applies bounded defaults', () => {
    const parsed = standalone.parse({ host: 'cache.internal' })
    expect(parsed).toEqual({
      mode: 'standalone',
      host: 'cache.internal',
      port: 6379,
      db: 0,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 2000,
      maxRetriesPerRequest: 1,
      batchSize: 500,
      maxValueBytes: 8 * 1024 * 1024,
    })
  })

  it('rejects unknown keys, a username without password and unbounded values', () => {
    const result = standalone.safeParse({
      host: 'h',
      username: 'app',
      batchSize: 0,
      commandTimeoutMs: 10_000_000,
      url: 'redis://x',
      tls: { cert: 'PEM' },
    })
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['batchSize', 'commandTimeoutMs', 'tls.key']))
    expect(result.success ? [] : result.error.issues.map((issue) => issue.code)).toContain('unrecognized_keys')
    const credentials = standalone.safeParse({ host: 'h', username: 'app' })
    expect(credentials.success ? [] : credentials.error.issues.map((issue) => issue.path.join('.'))).toEqual(['password'])
  })

  it('accepts cluster settings only through the full schema', () => {
    const cluster = { mode: 'cluster', nodes: [{ host: 'a' }, { host: 'b', port: 7001 }] }
    expect(standalone.safeParse(cluster).success).toBe(false)
    const parsed = createRespSettingsSchema().parse(cluster)
    expect(parsed.mode).toBe('cluster')
  })

  it('redacts credentials and key material', () => {
    const config = standalone.parse({
      host: 'cache.internal',
      username: 'app-user',
      password: 'super-secret-password',
      tls: { ca: '-----BEGIN CERTIFICATE-----secret-ca', cert: 'CERTDATA', key: 'PRIVATE-KEY-DATA' },
    })
    const redacted = redactRespSettings(config)
    const serialized = JSON.stringify(redacted)
    for (const secret of ['app-user', 'super-secret-password', 'secret-ca', 'CERTDATA', 'PRIVATE-KEY-DATA']) {
      expect(serialized).not.toContain(secret)
    }
    expect(redacted).toMatchObject({ host: 'cache.internal', password: '[redacted]', tls: { enabled: true, ca: 'configured', clientCertificate: true } })
  })
})

describe('RESP scripts and helpers', () => {
  it('publishes script digests matching their sources', () => {
    for (const script of [DELETE_IF_UNCHANGED, REAP_TAG_MEMBERS]) {
      expect(script.sha).toBe(createHash('sha1').update(script.source).digest('hex'))
    }
  })

  it('bounds the reconnect backoff', () => {
    expect(respReconnectDelay(1)).toBe(100)
    expect(respReconnectDelay(5)).toBe(500)
    expect(respReconnectDelay(1000)).toBe(2000)
  })

  it('identifies valkey, keydb and redis from INFO server', () => {
    expect(parseRespServerInfo('# Server\r\nredis_version:7.2.4\r\nserver_name:valkey\r\nvalkey_version:8.1.1\r\n')).toEqual({ engine: 'valkey', version: '8.1.1' })
    expect(parseRespServerInfo('# Server\nredis_version:7.2.5\nredis_mode:standalone\n')).toEqual({ engine: 'redis', version: '7.2.5' })
    expect(parseRespServerInfo('# Server\nredis_version:6.3.4\nexecutable:/usr/local/bin/keydb-server\n')).toEqual({ engine: 'keydb', version: '6.3.4' })
    expect(parseRespServerInfo('')).toEqual({ engine: 'unknown', version: null })
  })
})
