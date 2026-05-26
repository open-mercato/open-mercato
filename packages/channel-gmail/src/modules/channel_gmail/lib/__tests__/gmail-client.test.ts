import { decodeBase64Url, encodeBase64Url, GmailApiError } from '../gmail-client'

describe('base64url encoding helpers', () => {
  it('encodeBase64Url uses URL-safe alphabet without padding', () => {
    const buffer = Buffer.from('Hello, world?', 'utf-8')
    const encoded = encodeBase64Url(buffer)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
    expect(decodeBase64Url(encoded).toString('utf-8')).toBe('Hello, world?')
  })

  it('decodeBase64Url tolerates padded inputs', () => {
    const buffer = Buffer.from('1', 'utf-8')
    const encoded = buffer.toString('base64') // produces '1' → 'MQ=='
    expect(decodeBase64Url(encoded).toString('utf-8')).toBe('1')
  })

  it('round-trips arbitrary binary data', () => {
    const input = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(decodeBase64Url(encodeBase64Url(input))).toEqual(input)
  })
})

describe('GmailApiError', () => {
  it('captures status + detail for downstream classification', () => {
    const e = new GmailApiError('Gmail API GET /history failed: invalid_grant', 401, 'invalid_grant')
    expect(e.name).toBe('GmailApiError')
    expect(e.status).toBe(401)
    expect(e.detail).toBe('invalid_grant')
  })
})
