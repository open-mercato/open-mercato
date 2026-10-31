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

describe('webhookCreateSchema — reserved custom headers', () => {
  it('rejects custom headers that shadow Standard Webhooks signature headers', () => {
    const result = webhookCreateSchema.safeParse(baseInput({ customHeaders: { 'webhook-signature': 'forged' } }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/reserved/i)
    }
  })

  it('rejects reserved header names case-insensitively', () => {
    expect(webhookCreateSchema.safeParse(baseInput({ customHeaders: { 'Webhook-Id': 'constant' } })).success).toBe(false)
    expect(webhookCreateSchema.safeParse(baseInput({ customHeaders: { 'WEBHOOK-TIMESTAMP': '0' } })).success).toBe(false)
    expect(webhookCreateSchema.safeParse(baseInput({ customHeaders: { 'Content-Type': 'text/plain' } })).success).toBe(false)
  })

  it('rejects reserved headers on update', () => {
    const result = webhookUpdateSchema.safeParse({ customHeaders: { 'webhook-signature': 'forged' } })
    expect(result.success).toBe(false)
  })

  it('accepts non-reserved custom headers', () => {
    expect(webhookCreateSchema.safeParse(baseInput({ customHeaders: { 'x-api-key': 'value', authorization: 'Bearer token' } })).success).toBe(true)
    expect(webhookUpdateSchema.safeParse({ customHeaders: { 'x-api-key': 'value' } }).success).toBe(true)
  })
})

describe('webhookUpdateSchema — partial updates do not inject create defaults', () => {
  it('parses {isActive:false} to exactly {isActive:false}', () => {
    expect(webhookUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false })
  })

  it('parses {maxRetries:4} without adding any other key', () => {
    const parsed = webhookUpdateSchema.parse({ maxRetries: 4 })
    expect(parsed).toEqual({ maxRetries: 4 })
    expect(Object.keys(parsed)).toEqual(['maxRetries'])
  })

  it.each([
    ['maxRetries', 31],
    ['maxRetries', -1],
    ['timeoutMs', 999],
    ['timeoutMs', 60001],
    ['rateLimitPerMinute', -1],
    ['rateLimitPerMinute', 10001],
    ['autoDisableThreshold', 1001],
    ['autoDisableThreshold', -1],
    ['httpMethod', 'GET'],
    ['deliveryStrategy', 'smtp'],
  ])('still rejects out-of-bounds %s = %p', (field, value) => {
    expect(webhookUpdateSchema.safeParse({ [field]: value }).success).toBe(false)
  })

  it('still accepts in-bounds values for the defaulted fields', () => {
    const input = {
      httpMethod: 'PATCH',
      deliveryStrategy: 'http',
      maxRetries: 0,
      timeoutMs: 60000,
      rateLimitPerMinute: 10000,
      autoDisableThreshold: 0,
    }
    expect(webhookUpdateSchema.parse(input)).toEqual(input)
  })
})

describe('webhookCreateSchema — defaults', () => {
  it('applies every create default when the fields are omitted', () => {
    const parsed = webhookCreateSchema.parse(baseInput())
    expect(parsed).toMatchObject({
      httpMethod: 'POST',
      deliveryStrategy: 'http',
      maxRetries: 10,
      timeoutMs: 15000,
      rateLimitPerMinute: 0,
      autoDisableThreshold: 100,
    })
  })

  it('keeps explicit values over the defaults', () => {
    const parsed = webhookCreateSchema.parse(baseInput({
      httpMethod: 'PUT',
      maxRetries: 3,
      timeoutMs: 5000,
      rateLimitPerMinute: 7,
      autoDisableThreshold: 5,
    }))
    expect(parsed).toMatchObject({
      httpMethod: 'PUT',
      maxRetries: 3,
      timeoutMs: 5000,
      rateLimitPerMinute: 7,
      autoDisableThreshold: 5,
    })
  })

  it('still rejects out-of-bounds defaulted fields on create', () => {
    expect(webhookCreateSchema.safeParse(baseInput({ maxRetries: 31 })).success).toBe(false)
    expect(webhookCreateSchema.safeParse(baseInput({ timeoutMs: 999 })).success).toBe(false)
    expect(webhookCreateSchema.safeParse(baseInput({ httpMethod: 'GET' })).success).toBe(false)
  })
})
