import { channelSmtpHealthCheck } from '../health'
import { setSmtpTransport, type SmtpConnection } from '../transport'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const credentials = {
  host: 'smtp.example.com',
  port: 587,
  tls: 'starttls',
  user: 'mailer',
  password: 'secret',
  fromAddress: 'no-reply@example.com',
}

describe('channelSmtpHealthCheck', () => {
  afterEach(() => setSmtpTransport(null))

  it('reports healthy when the relay accepts the handshake and AUTH', async () => {
    const verified: SmtpConnection[] = []
    setSmtpTransport({
      async send() { return {} },
      async verify(connection) { verified.push(connection) },
    })

    const result = await channelSmtpHealthCheck.check(credentials, scope)

    expect(result.status).toBe('healthy')
    expect(result.details).toEqual(expect.objectContaining({ host: 'smtp.example.com', port: 587 }))
    expect(verified[0].timeoutMs).toBe(8_000)
  })

  it('reports unhealthy without dialling when credentials are invalid', async () => {
    let verifyCalls = 0
    setSmtpTransport({
      async send() { return {} },
      async verify() { verifyCalls += 1 },
    })

    const result = await channelSmtpHealthCheck.check({ ...credentials, host: '' }, scope)

    expect(result.status).toBe('unhealthy')
    expect(result.details.reason).toBe('invalid_credentials')
    expect(verifyCalls).toBe(0)
  })

  it('reports unhealthy when the relay rejects the connection', async () => {
    setSmtpTransport({
      async send() { return {} },
      async verify() { throw new Error('535 Authentication credentials invalid') },
    })

    const result = await channelSmtpHealthCheck.check(credentials, scope)

    expect(result.status).toBe('unhealthy')
    expect(result.details.reason).toBe('connection_failed')
    expect(result.message).toContain('535 Authentication credentials invalid')
  })

  it('never leaks the password into the health details', async () => {
    setSmtpTransport({
      async send() { return {} },
      async verify() { throw new Error('nope') },
    })
    const result = await channelSmtpHealthCheck.check(credentials, scope)
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
