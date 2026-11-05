import type { ImapCredentials } from '../credentials'
import { credentialsToConnection } from '../imap-client'
import { credentialsToSmtpConnection } from '../smtp-client'
import { assertTransportAllowed } from '../transport'

const baseCredentials: ImapCredentials = {
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapTls: 'tls',
  imapUser: 'alice@example.com',
  imapPassword: 'secret',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpTls: 'tls',
  smtpUser: 'alice@example.com',
  smtpPassword: 'secret',
  fromAddress: 'alice@example.com',
}

afterEach(() => {
  delete process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT
})

describe('assertTransportAllowed', () => {
  it('throws an [internal]-prefixed error when imapTls is none and the flag is unset', () => {
    expect(() => assertTransportAllowed({ ...baseCredentials, imapTls: 'none' })).toThrow(/^\[internal\]/)
    expect(() => assertTransportAllowed({ ...baseCredentials, imapTls: 'none' })).toThrow(/cleartext/i)
  })

  it('throws when smtpTls is none and the flag is unset', () => {
    expect(() => assertTransportAllowed({ ...baseCredentials, smtpTls: 'none' })).toThrow(/cleartext/i)
  })

  it('allows none transport when OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT is truthy', () => {
    process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT = 'true'
    expect(() => assertTransportAllowed({ ...baseCredentials, imapTls: 'none', smtpTls: 'none' })).not.toThrow()
  })

  it('always allows tls and starttls', () => {
    expect(() => assertTransportAllowed({ ...baseCredentials, imapTls: 'tls', smtpTls: 'starttls' })).not.toThrow()
  })
})

describe('credentialsToConnection (poll/send IMAP build) enforces transport', () => {
  it('throws when imapTls is none and the flag is unset', () => {
    expect(() => credentialsToConnection({ ...baseCredentials, imapTls: 'none' })).toThrow(/cleartext/i)
  })

  it('builds the connection when the flag is set', () => {
    process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT = 'true'
    const connection = credentialsToConnection({ ...baseCredentials, imapTls: 'none' })
    expect(connection.transport).toBe('none')
    expect(connection.host).toBe('imap.example.com')
  })
})

describe('credentialsToSmtpConnection (send SMTP build) enforces transport', () => {
  it('throws when smtpTls is none and the flag is unset', () => {
    expect(() => credentialsToSmtpConnection({ ...baseCredentials, smtpTls: 'none' })).toThrow(/cleartext/i)
  })

  it('builds the connection when the flag is set', () => {
    process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT = 'true'
    const connection = credentialsToSmtpConnection({ ...baseCredentials, smtpTls: 'none' })
    expect(connection.transport).toBe('none')
    expect(connection.host).toBe('smtp.example.com')
  })
})
