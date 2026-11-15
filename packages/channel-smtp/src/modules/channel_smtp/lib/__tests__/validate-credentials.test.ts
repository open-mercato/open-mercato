import { getSmtpChannelAdapter } from '../adapter'
import { setSmtpTransport, type SmtpConnection, type SmtpTransport } from '../transport'

const credentials = {
  host: 'smtp.example.com',
  port: 587,
  tls: 'starttls',
  user: 'mailer',
  password: 'secret',
  fromAddress: 'no-reply@example.com',
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function stubTransport(overrides: Partial<SmtpTransport> = {}): { verified: SmtpConnection[] } {
  const verified: SmtpConnection[] = []
  setSmtpTransport({
    async send() {
      return {}
    },
    async verify(connection) {
      verified.push(connection)
    },
    ...overrides,
  })
  return { verified }
}

function validate(payload: Record<string, unknown>) {
  return getSmtpChannelAdapter().validateCredentials!({
    providerKey: 'smtp',
    credentials: payload,
    scope,
  })
}

describe('SmtpChannelAdapter.validateCredentials', () => {
  afterEach(() => setSmtpTransport(null))

  it('accepts credentials the relay verifies', async () => {
    const { verified } = stubTransport()
    await expect(validate(credentials)).resolves.toEqual({ ok: true })
    expect(verified).toHaveLength(1)
    expect(verified[0]).toEqual(expect.objectContaining({ host: 'smtp.example.com', port: 587 }))
  })

  it('refuses a private relay host at save time instead of only at send time', async () => {
    const { verified } = stubTransport()
    const result = await validate({ ...credentials, host: '127.0.0.1' })

    expect(result.ok).toBe(false)
    expect(result.errors?.host).toMatch(/private or loopback/i)
    // A refused host must never be dialled.
    expect(verified).toHaveLength(0)
  })

  it('refuses cleartext transport unless the operator opted in', async () => {
    const { verified } = stubTransport()
    const result = await validate({ ...credentials, tls: 'none' })

    expect(result.ok).toBe(false)
    expect(result.errors?.tls).toMatch(/OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT/)
    expect(verified).toHaveLength(0)
  })

  it('reports missing fields per field so the connect form can highlight them', async () => {
    stubTransport()
    const result = await validate({ host: 'smtp.example.com', port: 587, tls: 'starttls' })

    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(['fromAddress', 'password', 'user'])
  })

  it('classifies a rejected login without echoing the relay banner back', async () => {
    stubTransport({
      async verify() {
        throw new Error('535 5.7.8 Authentication failed for mailer@internal-relay.corp')
      },
    })
    const result = await validate(credentials)

    expect(result.ok).toBe(false)
    expect(result.errors?.password).toBe(
      'Authentication rejected by the relay. Check the username and password.',
    )
    expect(JSON.stringify(result)).not.toContain('internal-relay.corp')
  })

  it('classifies an unreachable relay as a host/port problem', async () => {
    stubTransport({
      async verify() {
        throw new Error('connect ECONNREFUSED 203.0.113.10:587')
      },
    })
    const result = await validate(credentials)

    expect(result.ok).toBe(false)
    expect(result.errors?.password).toBe('Could not reach the relay. Check the host and port.')
  })
})
