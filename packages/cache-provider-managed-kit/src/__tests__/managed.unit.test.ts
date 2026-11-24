import { managedTlsSchema, managedTlsWithCaSchema, redactManagedTls, toRespTls } from '../managed'

const CA = '-----BEGIN CERTIFICATE-----\nFIXTURE\n-----END CERTIFICATE-----\n'

describe('managed TLS helpers', () => {
  it('always verifies the certificate and defaults the servername to a DNS host', () => {
    expect(toRespTls('cache.example.internal', undefined)).toEqual({ servername: 'cache.example.internal', rejectUnauthorized: true })
    expect(toRespTls('cache.example.internal', { ca: CA, servername: 'override.example' })).toEqual({ ca: CA, servername: 'override.example', rejectUnauthorized: true })
  })

  it('sends no SNI servername for IP endpoints unless one is configured', () => {
    expect(toRespTls('10.0.0.3', {})).toEqual({ rejectUnauthorized: true })
    expect(toRespTls('fd00::3', {})).toEqual({ rejectUnauthorized: true })
    expect(toRespTls('10.0.0.3', { servername: 'cache.internal' })).toEqual({ servername: 'cache.internal', rejectUnauthorized: true })
  })

  it('offers no verification bypass and requires CA material where the service needs it', () => {
    expect(managedTlsSchema.safeParse({ rejectUnauthorized: false }).success).toBe(false)
    expect(managedTlsWithCaSchema.safeParse({}).success).toBe(false)
    expect(managedTlsWithCaSchema.safeParse({ ca: CA }).success).toBe(true)
  })

  it('redacts CA material', () => {
    const redacted = redactManagedTls('cache.example.internal', { ca: CA })
    expect(redacted).toEqual({ enabled: true, ca: 'configured', servername: 'cache.example.internal', hostnameVerification: true })
    expect(JSON.stringify(redacted)).not.toContain('FIXTURE')
    expect(redactManagedTls('10.0.0.3', undefined)).toMatchObject({ ca: 'system', servername: null })
  })
})
