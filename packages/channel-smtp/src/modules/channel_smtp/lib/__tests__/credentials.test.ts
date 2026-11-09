import { smtpCredentialsSchema } from '../credentials'

const validCredentials = {
  host: 'smtp.example.com',
  port: 587,
  tls: 'starttls',
  user: 'mailer',
  password: 'secret',
  fromAddress: 'no-reply@example.com',
}

describe('smtpCredentialsSchema', () => {
  afterEach(() => {
    delete process.env.OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS
    delete process.env.OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT
  })

  it('accepts a well-formed relay configuration', () => {
    const parsed = smtpCredentialsSchema.parse(validCredentials)
    expect(parsed.host).toBe('smtp.example.com')
    expect(parsed.port).toBe(587)
  })

  it('coerces a string port, because credential blobs round-trip through form fields', () => {
    expect(smtpCredentialsSchema.parse({ ...validCredentials, port: '465' }).port).toBe(465)
  })

  it('keeps unknown keys so the credential store can stash its own bookkeeping', () => {
    const parsed = smtpCredentialsSchema.parse({ ...validCredentials, connectedBy: 'user-1' })
    expect(parsed).toEqual(expect.objectContaining({ connectedBy: 'user-1' }))
  })

  it.each([
    'localhost',
    '127.0.0.1',
    '169.254.169.254',
    '10.0.0.5',
    '[::1]',
    '2130706433',
    '0x7f.0.0.1',
  ])('rejects internal host %s', (host) => {
    const result = smtpCredentialsSchema.safeParse({ ...validCredentials, host })
    expect(result.success).toBe(false)
  })

  it('allows an internal host once an operator opts in', () => {
    process.env.OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS = 'true'
    expect(smtpCredentialsSchema.safeParse({ ...validCredentials, host: 'localhost' }).success).toBe(true)
  })

  it('rejects cleartext transport by default', () => {
    const result = smtpCredentialsSchema.safeParse({ ...validCredentials, tls: 'none' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT/)
  })

  it('allows cleartext transport once an operator opts in', () => {
    process.env.OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT = 'true'
    expect(smtpCredentialsSchema.safeParse({ ...validCredentials, tls: 'none' }).success).toBe(true)
  })

  it.each([0, 65536, 1.5])('rejects out-of-range port %s', (port) => {
    expect(smtpCredentialsSchema.safeParse({ ...validCredentials, port }).success).toBe(false)
  })

  it('rejects a malformed from-address', () => {
    expect(smtpCredentialsSchema.safeParse({ ...validCredentials, fromAddress: 'nope' }).success).toBe(false)
  })
})
