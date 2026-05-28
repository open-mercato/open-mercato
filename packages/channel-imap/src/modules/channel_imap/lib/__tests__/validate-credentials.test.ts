import { setImapClient } from '../imap-client'
import { setSmtpClient } from '../smtp-client'
import { validateImapCredentials } from '../validate-credentials'

const validRaw = {
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
  setImapClient(null)
  setSmtpClient(null)
  delete process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT
})

describe('validateImapCredentials', () => {
  it('returns shape errors before attempting a network login', async () => {
    let imapTouched = false
    let smtpTouched = false
    setImapClient({
      connectAndValidate: async () => {
        imapTouched = true
        return { capabilities: [] }
      },
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => undefined,
    })
    setSmtpClient({
      verify: async () => {
        smtpTouched = true
      },
      send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }),
    })
    const result = await validateImapCredentials({ ...validRaw, imapPort: 70_000 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors?.imapPort).toMatch(/IMAP port/i)
    }
    expect(imapTouched).toBe(false)
    expect(smtpTouched).toBe(false)
  })

  it('returns field-level imap error when imap login fails', async () => {
    setImapClient({
      connectAndValidate: async () => {
        throw new Error('535 5.7.8 Authentication credentials invalid')
      },
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => undefined,
    })
    setSmtpClient({
      verify: async () => undefined,
      send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }),
    })
    const result = await validateImapCredentials(validRaw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors?.imapPassword).toMatch(/authentication/i)
      expect(result.errors?.smtpPassword).toBeUndefined()
    }
  })

  it('returns field-level smtp error when smtp verify fails', async () => {
    setImapClient({
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => undefined,
    })
    setSmtpClient({
      verify: async () => {
        throw new Error('ECONNREFUSED smtp.example.com')
      },
      send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }),
    })
    const result = await validateImapCredentials(validRaw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors?.smtpPassword).toMatch(/could not reach/i)
    }
  })

  it('returns ok when both servers accept the login', async () => {
    setImapClient({
      connectAndValidate: async () => ({ capabilities: ['IMAP4rev1'] }),
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => undefined,
    })
    setSmtpClient({
      verify: async () => undefined,
      send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }),
    })
    const result = await validateImapCredentials(validRaw)
    expect(result.ok).toBe(true)
  })

  it("rejects 'none' transport by default without touching the network", async () => {
    let imapTouched = false
    setImapClient({
      connectAndValidate: async () => {
        imapTouched = true
        return { capabilities: [] }
      },
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => undefined,
    })
    setSmtpClient({
      verify: async () => undefined,
      send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }),
    })
    const result = await validateImapCredentials({
      ...validRaw,
      imapTls: 'none',
      smtpTls: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors?.imapTls).toMatch(/cleartext/i)
      expect(result.errors?.smtpTls).toMatch(/cleartext/i)
    }
    expect(imapTouched).toBe(false)
  })

  it("allows 'none' transport when OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT is truthy", async () => {
    process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT = 'true'
    setImapClient({
      connectAndValidate: async () => ({ capabilities: ['IMAP4rev1'] }),
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => undefined,
    })
    setSmtpClient({
      verify: async () => undefined,
      send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }),
    })
    const result = await validateImapCredentials({
      ...validRaw,
      imapTls: 'none',
      smtpTls: 'none',
    })
    expect(result.ok).toBe(true)
  })
})
