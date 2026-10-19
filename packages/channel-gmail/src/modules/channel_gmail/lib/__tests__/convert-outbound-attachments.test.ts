import { convertOutboundForGmail } from '../convert-outbound'
import { getGmailChannelAdapter } from '../adapter'

describe('convertOutboundForGmail — attachments', () => {
  it('advertises file sharing', () => {
    expect(getGmailChannelAdapter().capabilities.fileSharing).toBe(true)
  })

  it('stitches the attachment bytes into a multipart/mixed message and keeps Bcc and a quoted display name', async () => {
    const pdf = Buffer.from('%PDF-1.7 order 42')
    const result = await convertOutboundForGmail({
      body: '<p>Order attached</p>',
      bodyFormat: 'html',
      attachments: [{ url: '', fileName: 'Zamówienie 42.pdf', mimeType: 'application/pdf', content: pdf }],
      channelMetadata: { subject: 'Order 42', to: ['bob@example.com'], bcc: ['archive@example.com'] },
      fromAddress: 'alice@gmail.com',
      fromName: 'Kowalska, Anna',
    })

    const raw = ((result.metadata as Record<string, unknown>).rawMessage as Buffer).toString('utf-8')
    const headers = raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ')
    expect(headers).toContain('Content-Type: multipart/mixed')
    expect(headers).toContain('Bcc: archive@example.com')
    expect(headers).toContain('From: "Kowalska, Anna" <alice@gmail.com>')
    expect(raw).toMatch(/filename\*0\*=utf-8''Zam%C3%B3wienie%2042\.pdf/)
    const partStart = raw.indexOf('Content-Type: application/pdf')
    const bodyStart = raw.indexOf('\r\n\r\n', partStart) + 4
    const bodyEnd = raw.indexOf('\r\n--', bodyStart)
    expect(Buffer.from(raw.slice(bodyStart, bodyEnd).replace(/\r\n/g, ''), 'base64').equals(pdf)).toBe(true)
  })

  it('refuses an attachment that only has a remote URL', async () => {
    await expect(
      convertOutboundForGmail({
        body: 'x',
        bodyFormat: 'text',
        attachments: [{ url: 'https://files.example.net/a.pdf', fileName: 'a.pdf', mimeType: 'application/pdf' }],
        channelMetadata: { to: ['bob@example.com'] },
        fromAddress: 'alice@gmail.com',
      }),
    ).rejects.toThrow()
  })
})
