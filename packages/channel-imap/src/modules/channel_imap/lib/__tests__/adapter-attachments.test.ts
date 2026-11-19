import { setImapClient, type ImapClient } from '../imap-client'
import { isSmtpMessageTooLarge, setSmtpClient, type SmtpClient, type SmtpMessage } from '../smtp-client'
import { getImapChannelAdapter } from '../adapter'

const credentials = {
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

const metadata = { subject: 'Order 42', to: ['bob@example.com'] }
const scope = { tenantId: 't', organizationId: 'o' }

function installClients(send: SmtpClient['send']) {
  const imap: ImapClient = {
    connectAndValidate: async () => ({ capabilities: [] }),
    selectInbox: async () => ({}),
    fetchUidRange: async () => [],
    appendSent: async () => undefined,
  }
  setSmtpClient({ verify: async () => undefined, send })
  setImapClient(imap)
}

afterEach(() => {
  setImapClient(null)
  setSmtpClient(null)
})

describe('ImapChannelAdapter.sendMessage — attachments', () => {
  it('advertises file sharing', () => {
    expect(getImapChannelAdapter().capabilities.fileSharing).toBe(true)
  })

  it('hands the attachment bytes to SMTP, from hub bytes or a data: URL', async () => {
    const messages: SmtpMessage[] = []
    installClients(async (_options, message) => {
      messages.push(message)
      return { messageId: '<out@example.com>', raw: Buffer.from('RAW'), response: '250 OK' }
    })

    const result = await getImapChannelAdapter().sendMessage({
      content: {
        text: 'See attached',
        bodyFormat: 'text',
        attachments: [
          { url: '', fileName: 'order.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-1.7') },
          { url: 'data:text/csv;base64,YSxi', fileName: 'lines.csv', mimeType: 'text/csv', inline: false },
        ],
      },
      credentials,
      scope,
      metadata,
    })

    expect(result.status).toBe('sent')
    expect(messages[0].attachments).toEqual([
      { filename: 'order.pdf', content: Buffer.from('%PDF-1.7'), contentType: 'application/pdf', inline: undefined },
      { filename: 'lines.csv', content: Buffer.from('a,b'), contentType: 'text/csv', inline: false },
    ])
  })

  it('refuses a remote attachment URL without sending', async () => {
    const send = jest.fn()
    installClients(send)

    const result = await getImapChannelAdapter().sendMessage({
      content: {
        text: 'See attached',
        bodyFormat: 'text',
        attachments: [{ url: 'https://files.example.net/a.pdf', fileName: 'a.pdf', mimeType: 'application/pdf' }],
      },
      credentials,
      scope,
      metadata,
    })

    expect(result.status).toBe('failed')
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a server size rejection as message_too_large', async () => {
    installClients(async () => {
      throw Object.assign(new Error('Message failed: 552 5.3.4 Message size exceeds fixed limit'), {
        code: 'EMESSAGE',
        responseCode: 552,
        response: '552 5.3.4 Message size exceeds fixed limit',
      })
    })

    const result = await getImapChannelAdapter().sendMessage({
      content: { text: 'big', bodyFormat: 'text' },
      credentials,
      scope,
      metadata,
    })

    expect(result).toMatchObject({ status: 'failed' })
    expect(result.error).toContain('message_too_large')
  })

  it('still throws other SMTP failures so the hub classifies them', async () => {
    installClients(async () => {
      throw Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' })
    })

    await expect(
      getImapChannelAdapter().sendMessage({ content: { text: 'x', bodyFormat: 'text' }, credentials, scope, metadata }),
    ).rejects.toThrow('Connection timeout')
  })
})

describe('isSmtpMessageTooLarge', () => {
  it.each([
    [{ responseCode: 552, response: '552 5.3.4 Message size exceeds fixed limit' }, true],
    [{ responseCode: 554, response: '554 5.2.3 Message too big' }, true],
    [{ code: 'EMESSAGE', message: 'Message size larger than allowed 10485760' }, true],
    [{ responseCode: 552, response: '552 Message size exceeds maximum permitted' }, true],
    [{ responseCode: 552, response: '552 5.2.2 Mailbox full' }, false],
    [{ responseCode: 552, response: '552 5.2.2 Mailbox size limit exceeded' }, false],
    [{ responseCode: 552, response: '552 Requested mail action aborted: mailbox size limit exceeded' }, false],
    [{ responseCode: 550, response: '550 5.1.1 User unknown' }, false],
    [new Error('socket hang up'), false],
  ])('classifies %j as %s', (error, expected) => {
    expect(isSmtpMessageTooLarge(error)).toBe(expected)
  })
})
