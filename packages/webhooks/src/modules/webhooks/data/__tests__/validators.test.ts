import { webhookCreateSchema, webhookUpdateSchema } from '../validators'

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Test hook',
    url: 'https://hooks.example.com/endpoint',
    subscribedEvents: ['customers.person.created'],
    ...overrides,
  }
}

describe('webhookCreateSchema — URL safety', () => {
  const originalAllowPrivateUrls = process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS

  afterEach(() => {
    if (originalAllowPrivateUrls === undefined) {
      delete process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS
    } else {
      process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = originalAllowPrivateUrls
    }
  })

  it('accepts safe public URLs', () => {
    const result = webhookCreateSchema.safeParse(baseInput())
    expect(result.success).toBe(true)
  })

  it('rejects loopback IPv4 literal', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'http://127.0.0.1:3000/x' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/private|reserved/i)
    }
  })

  it('rejects AWS metadata literal', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'http://169.254.169.254/latest/meta-data/iam' }))
    expect(result.success).toBe(false)
  })

  it('rejects private RFC1918 literal', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'http://10.0.0.5/ingest' }))
    expect(result.success).toBe(false)
  })

  it('rejects localhost hostname', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'http://localhost:9200/_search' }))
    expect(result.success).toBe(false)
  })

  it('rejects .internal DNS suffix', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'http://metadata.google.internal/' }))
    expect(result.success).toBe(false)
  })

  it('rejects non-http(s) protocols', () => {
    expect(webhookCreateSchema.safeParse(baseInput({ url: 'ftp://example.test/x' })).success).toBe(false)
    expect(webhookCreateSchema.safeParse(baseInput({ url: 'gopher://example.test/x' })).success).toBe(false)
  })

  it('rejects URLs with embedded basic-auth credentials', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'https://user:pass@example.test/hook' }))
    expect(result.success).toBe(false)
  })

  it('rejects IPv6 loopback literal', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ url: 'http://[::1]:9200/' }))
    expect(result.success).toBe(false)
  })

  it('rejects unsafe URLs on update', () => {
    const result = webhookUpdateSchema.safeParse({ url: 'http://[::ffff:127.0.0.1]/' })
    expect(result.success).toBe(false)
  })

  it('accepts private create and update URLs when the development override is enabled', () => {
    process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = '1'

    expect(webhookCreateSchema.safeParse(baseInput({ url: 'http://localhost:3000/webhooks' })).success).toBe(true)
    expect(webhookUpdateSchema.safeParse({ url: 'http://10.0.0.5:3000/webhooks' }).success).toBe(true)
  })

  it('still rejects forbidden protocols and embedded credentials when the development override is enabled', () => {
    process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = '1'

    expect(webhookCreateSchema.safeParse(baseInput({ url: 'ftp://localhost/webhooks' })).success).toBe(false)
    expect(webhookCreateSchema.safeParse(baseInput({ url: 'https://user:pass@localhost/webhooks' })).success).toBe(false)
  })
})
