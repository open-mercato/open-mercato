import {
  assembleRfc2822,
  decodeCursor,
  encodeAddressHeaderWord,
  encodeCursor,
  encodeHeaderWord,
  escapeQuotes,
  extractHeaders,
  generateMessageId,
  htmlToText,
  normalizeMimeInbound,
  parseReferences,
  referencesFromMeta,
  sanitizeHeaderValue,
  stripBrackets,
  toAddressList,
  type ParsedMail,
} from '../email-mime'

function decodeEncodedWord(word: string): string {
  const match = word.match(/^=\?utf-8\?B\?(.*)\?=$/)
  if (!match) throw new Error(`not an RFC 2047 B encoded-word: ${word}`)
  return Buffer.from(match[1], 'base64').toString('utf-8')
}

describe('extractHeaders', () => {
  // Regression guard: mailparser returns `headers` as a Map. `Object.entries` on a
  // Map yields [], which previously made Gmail inbound `channelMetadata.headers` {}.
  it('flattens a Map of headers (the case that broke Gmail)', () => {
    const headers = new Map<string, unknown>([
      ['subject', 'Hello'],
      ['references', ['<a@x>', '<b@x>']],
      ['date', new Date('2026-05-28T00:00:00.000Z')],
    ])
    expect(extractHeaders(headers)).toEqual({
      subject: 'Hello',
      references: '<a@x>, <b@x>',
      date: '2026-05-28T00:00:00.000Z',
    })
  })

  it('flattens a plain-object header bag (test-fake fallback)', () => {
    expect(extractHeaders({ from: 'a@x', to: 'b@x' })).toEqual({ from: 'a@x', to: 'b@x' })
  })

  it('returns {} for missing headers', () => {
    expect(extractHeaders(undefined)).toEqual({})
  })
})

describe('generateMessageId', () => {
  it('roots the id in the sender domain', () => {
    expect(generateMessageId('alice@gmail.com')).toMatch(/^<[^@]+@gmail\.com>$/)
  })

  it('falls back to the provided domain when the address has none', () => {
    expect(generateMessageId('no-at-sign', 'example.com')).toMatch(/^<[^@]+@example\.com>$/)
  })

  it('is unique across calls', () => {
    expect(generateMessageId('a@b.com')).not.toBe(generateMessageId('a@b.com'))
  })
})

describe('referencesFromMeta', () => {
  it('returns a filtered string array', () => {
    expect(referencesFromMeta(['<a>', 2, '<b>'])).toEqual(['<a>', '<b>'])
  })

  it('returns undefined for a non-array', () => {
    expect(referencesFromMeta('<a>')).toBeUndefined()
  })
})

describe('toAddressList', () => {
  it('splits a delimited string', () => {
    expect(toAddressList('a@x.com, b@x.com; c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })

  it('passes an array through, trimming empties', () => {
    expect(toAddressList(['a@x.com', '', ' b@x.com '])).toEqual(['a@x.com', 'b@x.com'])
  })
})

describe('stripBrackets / parseReferences', () => {
  it('strips angle brackets', () => {
    expect(stripBrackets('<a@x>')).toBe('a@x')
    expect(stripBrackets(undefined)).toBeUndefined()
  })

  it('parses a space-delimited references header and an array', () => {
    expect(parseReferences('<root@x> <parent@x>')).toEqual(['root@x', 'parent@x'])
    expect(parseReferences(['<a@x>'])).toEqual(['a@x'])
    expect(parseReferences(null)).toEqual([])
  })
})

describe('htmlToText', () => {
  it('strips tags and decodes basic entities', () => {
    expect(htmlToText('<p>Hi <b>there</b></p>&amp;more')).toBe('Hi there\n\n&more')
  })

  it('does not double-unescape an entity-encoded entity', () => {
    expect(htmlToText('<p>&amp;lt;b&amp;gt;</p>')).toBe('&lt;b&gt;')
  })

  it('strips script/style blocks whose close tag carries whitespace or attributes', () => {
    expect(htmlToText('a<script>alert(1)</script >b')).toBe('a b')
    expect(htmlToText('a<script>alert(1)</script foo="bar">b')).toBe('a b')
    expect(htmlToText('a<STYLE>.x{}</STYLE>b')).toBe('a b')
  })

  it('removes a script tag reconstructed by a single sanitization pass', () => {
    expect(htmlToText('<scr<script>ipt>alert(1)</scr</script>ipt>')).toBe('')
  })

  it('removes unterminated or truncated script/style blocks so no tag prefix leaks', () => {
    expect(htmlToText('a<script>alert(1)')).toBe('a')
    expect(htmlToText('hello<script')).toBe('hello')
    expect(htmlToText('a<style>.x{color:red}')).toBe('a')
  })

  it('strips HTML comments, including a comment wrapping a tag fragment', () => {
    expect(htmlToText('a<!-- hidden -->b')).toBe('a b')
    expect(htmlToText('a<!--<script-->b')).toBe('a b')
    expect(htmlToText('a<!-- unterminated comment')).toBe('a')
  })

  it('decodes entities in a single pass so a produced entity is never re-decoded', () => {
    // &amp;amp; -> &amp; (literal), not & — the produced "&amp;" must not decode again.
    expect(htmlToText('<p>&amp;amp;</p>')).toBe('&amp;')
    // &amp;nbsp; -> &nbsp; (literal), the produced "&nbsp;" must not become a space.
    expect(htmlToText('<p>x&amp;nbsp;y</p>')).toBe('x&nbsp;y')
  })
})

describe('escapeQuotes', () => {
  it('escapes the backslash before the quote so the quote cannot be un-escaped', () => {
    expect(escapeQuotes('a"b')).toBe('a\\"b')
    expect(escapeQuotes('a\\"b')).toBe('a\\\\\\"b')
    expect(escapeQuotes('a\\')).toBe('a\\\\')
  })
})

describe('assembleRfc2822', () => {
  it('builds a multipart/alternative message with threading headers', () => {
    const raw = assembleRfc2822({
      from: '"Alice" <alice@x.com>',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'plain',
      html: '<p>rich</p>',
      inReplyTo: '<root@x.com>',
      references: ['<root@x.com>'],
      messageId: '<m@x.com>',
    }).toString('utf-8')
    expect(raw).toContain('From: "Alice" <alice@x.com>')
    expect(raw).toContain('Subject: Hi')
    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('In-Reply-To: <root@x.com>')
    expect(raw).toContain('<p>rich</p>')
  })

  it('collapses CR/LF in headers so a caller cannot inject extra headers', () => {
    const raw = assembleRfc2822({
      from: 'alice@x.com',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Hello\r\nBcc: exfil@evil.com',
      text: 'body',
      html: undefined,
      inReplyTo: '<root@x.com>\r\nX-Injected: 1',
      references: ['<root@x.com>\r\nX-Injected: 2'],
      messageId: '<m@x.com>',
    }).toString('utf-8')
    const headerLines = raw.split('\r\n\r\n')[0].split('\r\n')
    expect(headerLines.some((line) => /^Bcc:/i.test(line))).toBe(false)
    expect(headerLines.some((line) => /^X-Injected:/i.test(line))).toBe(false)
    // The payload survives only as part of the single-line Subject, not as a header.
    expect(headerLines).toContain('Subject: Hello Bcc: exfil@evil.com')
  })

  it('RFC-2047 encodes a non-ASCII Subject so accents survive a strict MTA', () => {
    const raw = assembleRfc2822({
      from: 'alice@x.com',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Café meeting',
      text: 'body',
      html: undefined,
      inReplyTo: undefined,
      references: undefined,
      messageId: '<m@x.com>',
    }).toString('utf-8')
    const headerLines = raw.split('\r\n\r\n')[0].split('\r\n')
    const subjectLine = headerLines.find((line) => line.startsWith('Subject: '))!
    const word = subjectLine.slice('Subject: '.length)
    expect(word).toMatch(/^=\?utf-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(decodeEncodedWord(word)).toBe('Café meeting')
    // No raw 8-bit byte leaks into the header line.
    expect(/[^\x00-\x7F]/.test(subjectLine)).toBe(false)
  })

  it('base64-encodes a non-ASCII text body and labels it Content-Transfer-Encoding: base64', () => {
    const raw = assembleRfc2822({
      from: 'alice@x.com',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'Voilà — accented body',
      html: undefined,
      inReplyTo: undefined,
      references: undefined,
      messageId: '<m@x.com>',
    }).toString('utf-8')
    const [headerBlock, ...bodyBlocks] = raw.split('\r\n\r\n')
    expect(headerBlock).toContain('Content-Transfer-Encoding: base64')
    const body = bodyBlocks.join('\r\n\r\n').trim()
    expect(Buffer.from(body, 'base64').toString('utf-8')).toBe('Voilà — accented body')
  })

  it('base64-encodes only the non-ASCII part of a multipart/alternative message', () => {
    const raw = assembleRfc2822({
      from: 'alice@x.com',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'plain ascii',
      html: '<p>Café</p>',
      inReplyTo: undefined,
      references: undefined,
      messageId: '<m@x.com>',
    }).toString('utf-8')
    // The ASCII text/plain part stays 7bit and verbatim.
    expect(raw).toContain('plain ascii')
    expect(raw).toMatch(/text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit/)
    // The non-ASCII text/html part is base64.
    expect(raw).toMatch(/text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64/)
    expect(raw).not.toContain('<p>Café</p>')
  })

  it('keeps an ASCII-only message fully unencoded (regression)', () => {
    const raw = assembleRfc2822({
      from: '"Alice" <alice@x.com>',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Plain ASCII subject',
      text: 'plain body',
      html: '<p>rich</p>',
      inReplyTo: undefined,
      references: undefined,
      messageId: '<m@x.com>',
    }).toString('utf-8')
    expect(raw).toContain('Subject: Plain ASCII subject')
    expect(raw).not.toContain('=?utf-8?B?')
    expect(raw).toContain('Content-Transfer-Encoding: 7bit')
    expect(raw).not.toContain('Content-Transfer-Encoding: base64')
    expect(raw).toContain('plain body')
    expect(raw).toContain('<p>rich</p>')
  })

  it('encodes a non-ASCII display name but never the addr-spec in From', () => {
    const raw = assembleRfc2822({
      from: '"Renée Dûpont" <renee@x.com>',
      to: ['bob@x.com'],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'body',
      html: undefined,
      inReplyTo: undefined,
      references: undefined,
      messageId: '<m@x.com>',
    }).toString('utf-8')
    const fromLine = raw.split('\r\n\r\n')[0].split('\r\n').find((line) => line.startsWith('From: '))!
    expect(fromLine).toContain('<renee@x.com>')
    const word = fromLine.slice('From: '.length).replace(' <renee@x.com>', '')
    expect(decodeEncodedWord(word)).toBe('Renée Dûpont')
  })
})

describe('encodeHeaderWord', () => {
  it('returns ASCII values unchanged', () => {
    expect(encodeHeaderWord('Re: Hello-World')).toBe('Re: Hello-World')
  })

  it('emits an RFC 2047 B encoded-word for non-ASCII', () => {
    const encoded = encodeHeaderWord('Café')
    expect(encoded).toBe('=?utf-8?B?Q2Fmw6k=?=')
    expect(decodeEncodedWord(encoded)).toBe('Café')
  })
})

describe('encodeAddressHeaderWord', () => {
  it('passes a pure-ASCII address through untouched', () => {
    expect(encodeAddressHeaderWord('"Alice" <alice@x.com>')).toBe('"Alice" <alice@x.com>')
  })

  it('encodes only the display name, leaving the addr-spec intact', () => {
    const encoded = encodeAddressHeaderWord('"Renée" <renee@x.com>')
    expect(encoded).toMatch(/ <renee@x\.com>$/)
    expect(decodeEncodedWord(encoded.replace(' <renee@x.com>', ''))).toBe('Renée')
  })

  it('encodes a bare non-ASCII value with no addr-spec', () => {
    expect(decodeEncodedWord(encodeAddressHeaderWord('Müller'))).toBe('Müller')
  })
})

describe('sanitizeHeaderValue', () => {
  it('collapses CR/LF/TAB to a single space and trims', () => {
    expect(sanitizeHeaderValue('Hello\r\nBcc: x@y.z')).toBe('Hello Bcc: x@y.z')
    expect(sanitizeHeaderValue('a\tb')).toBe('a b')
    expect(sanitizeHeaderValue('  spaced  ')).toBe('spaced')
  })

  it('leaves clean values (spaces, hyphens) untouched', () => {
    expect(sanitizeHeaderValue('Re: Hello-World')).toBe('Re: Hello-World')
  })
})

describe('encodeCursor / decodeCursor', () => {
  it('round-trips an object', () => {
    const state = { uid: 42, folder: 'INBOX' }
    expect(decodeCursor(encodeCursor(state))).toEqual(state)
  })

  it('returns null for malformed or empty input', () => {
    expect(decodeCursor('!!!not-base64-json')).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
  })
})

describe('normalizeMimeInbound', () => {
  const baseParsed: ParsedMail = {
    messageId: '<reply@x.com>',
    inReplyTo: '<parent@x.com>',
    references: '<root@x.com> <parent@x.com>',
    from: { value: [{ address: 'alice@x.com', name: 'Alice' }] },
    to: { value: [{ address: 'bob@x.com' }] },
    subject: 'Re: original',
    text: 'replying',
    date: '2026-05-28T10:00:00.000Z',
    headers: new Map<string, unknown>([['x-trace', 'abc']]),
  }

  it('normalizes threading, sender, body and Map headers', () => {
    const result = normalizeMimeInbound({
      parsed: baseParsed,
      accountIdentifier: 'bob@x.com',
      fallbackMessageId: 'fallback:1@bob@x.com',
      resolveConversationId: ({ references, messageId }) => references[0] ?? messageId,
    })
    expect(result.externalMessageId).toBe('reply@x.com')
    expect(result.externalConversationId).toBe('root@x.com')
    expect(result.replyToExternalId).toBe('parent@x.com')
    expect(result.senderIdentifier).toBe('alice@x.com')
    expect(result.senderDisplayName).toBe('Alice')
    expect(result.bodyFormat).toBe('text')
    // The Map-header path must populate channelMetadata.headers (Gmail bug guard).
    expect((result.channelMetadata as { headers: Record<string, string> }).headers).toEqual({ 'x-trace': 'abc' })
  })

  it('uses the fallback id when Message-ID is absent and merges provider extras', () => {
    const result = normalizeMimeInbound({
      parsed: { ...baseParsed, messageId: null },
      accountIdentifier: 'bob@x.com',
      fallbackMessageId: 'gmail:7@bob@x.com',
      resolveConversationId: () => 'gmail-thread:t-1',
      channelMetadata: () => ({ gmailThreadId: 't-1' }),
      channelPayload: () => ({ gmailThreadId: 't-1' }),
    })
    expect(result.externalMessageId).toBe('gmail:7@bob@x.com')
    expect(result.externalConversationId).toBe('gmail-thread:t-1')
    expect((result.channelMetadata as { gmailThreadId: string }).gmailThreadId).toBe('t-1')
    expect((result.channelPayload as { gmailThreadId: string }).gmailThreadId).toBe('t-1')
  })

  it('prefers the html body when present', () => {
    const result = normalizeMimeInbound({
      parsed: { ...baseParsed, html: '<p>rich</p>', text: undefined },
      accountIdentifier: 'bob@x.com',
      fallbackMessageId: 'fallback:1@bob@x.com',
      resolveConversationId: ({ messageId }) => messageId,
    })
    expect(result.bodyFormat).toBe('html')
    expect(result.body).toContain('<p>rich</p>')
  })
})
