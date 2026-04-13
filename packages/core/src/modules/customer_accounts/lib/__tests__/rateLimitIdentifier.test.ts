/** @jest-environment node */

import { readNormalizedEmailFromJsonRequest } from '../rateLimitIdentifier'

describe('readNormalizedEmailFromJsonRequest', () => {
  it('returns a trimmed, lower-case email from JSON without consuming the request body', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email: '  User@Example.COM  ', password: 'secret123' }),
    })

    await expect(readNormalizedEmailFromJsonRequest(req)).resolves.toBe('user@example.com')
    await expect(req.json()).resolves.toEqual({ email: '  User@Example.COM  ', password: 'secret123' })
  })

  it('returns undefined when the JSON body has no string email', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email: null }),
    })

    await expect(readNormalizedEmailFromJsonRequest(req)).resolves.toBeUndefined()
  })

  it('returns undefined for malformed JSON', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: '{',
    })

    await expect(readNormalizedEmailFromJsonRequest(req)).resolves.toBeUndefined()
  })
})
