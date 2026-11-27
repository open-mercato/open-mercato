import { composeEmailMessage, type ComposeEmailMessageInput } from '../email-mime'

const baseInput: ComposeEmailMessageInput = {
  from: '"Anna Example" <anna@example.com>',
  to: ['buyer@example.org'],
  cc: [],
  bcc: [],
  subject: 'Quote request',
  text: 'Hello',
  html: undefined,
  inReplyTo: undefined,
  references: undefined,
  messageId: 'fixed-id@example.com',
}

function headerBlock(raw: Buffer): string {
  return raw.toString('utf-8').split('\r\n\r\n')[0]
}

function unfoldedHeaders(raw: Buffer): string[] {
  return headerBlock(raw).replace(/\r\n[ \t]+/g, ' ').split('\r\n')
}

function decodeBase64Part(raw: string, marker: string): Buffer {
  const start = raw.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const bodyStart = raw.indexOf('\r\n\r\n', start) + 4
  const bodyEnd = raw.indexOf('\r\n--', bodyStart)
  return Buffer.from(raw.slice(bodyStart, bodyEnd).replace(/\r\n/g, ''), 'base64')
}

describe('composeEmailMessage', () => {
  it('keeps the caller Message-ID, threading headers and Bcc', async () => {
    const raw = await composeEmailMessage({
      ...baseInput,
      bcc: ['hidden@example.org'],
      inReplyTo: 'parent@example.org',
      references: ['root@example.org', '<parent@example.org>'],
    })
    const headers = unfoldedHeaders(raw)
    expect(headers).toContain('Message-ID: <fixed-id@example.com>')
    expect(headers).toContain('In-Reply-To: <parent@example.org>')
    expect(headers).toContain('References: <root@example.org> <parent@example.org>')
    expect(headers).toContain('Bcc: hidden@example.org')
  })

  it('folds a long non-ASCII subject into RFC 2047 words within the line limit', async () => {
    const subject = 'Zapytanie ofertowe – zestawienie materiałów na budowę (beton, stal, zbrojenie, deskowanie)'
    const raw = await composeEmailMessage({ ...baseInput, subject })
    const lines = headerBlock(raw).split('\r\n')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78)
    const subjectLine = unfoldedHeaders(raw).find((line) => line.startsWith('Subject: '))
    expect(subjectLine).toMatch(/=\?UTF-8\?[QB]\?/i)
  })

  it('neutralises CR/LF in header values so no header can be injected', async () => {
    const raw = await composeEmailMessage({ ...baseInput, subject: 'Hello\r\nBcc: attacker@example.net' })
    const headers = unfoldedHeaders(raw)
    expect(headers.some((line) => line.startsWith('Bcc:'))).toBe(false)
  })

  it('wraps text and html into multipart/alternative without attachments', async () => {
    const raw = await composeEmailMessage({ ...baseInput, html: '<p>Hello</p>' })
    expect(headerBlock(raw)).toMatch(/Content-Type: multipart\/alternative/)
  })

  it('adds attachments as multipart/mixed parts with their exact bytes and an encoded filename', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x10])
    const raw = await composeEmailMessage({
      ...baseInput,
      html: '<p>Hello</p>',
      attachments: [{ fileName: 'Zestawienie Łódź.pdf', mimeType: 'application/pdf', content: bytes }],
    })
    const text = raw.toString('utf-8')
    expect(headerBlock(raw)).toMatch(/Content-Type: multipart\/mixed/)
    expect(text).toMatch(/Content-Type: multipart\/alternative/)
    expect(text).toMatch(/Content-Disposition: attachment;\r\n filename\*0\*=utf-8''Zestawienie%20%C5%81/)
    expect(decodeBase64Part(text, 'Content-Type: application/pdf').equals(bytes)).toBe(true)
  })

  it('marks inline attachments with their content id', async () => {
    const raw = await composeEmailMessage({
      ...baseInput,
      html: '<img src="cid:logo@example.com">',
      attachments: [
        { fileName: 'logo.png', mimeType: 'image/png', content: Buffer.from('png'), inline: true, contentId: 'logo@example.com' },
      ],
    })
    const text = raw.toString('utf-8')
    expect(text).toMatch(/Content-Disposition: inline; filename=logo\.png/)
    expect(text).toMatch(/Content-ID: <logo@example\.com>/)
  })
})
