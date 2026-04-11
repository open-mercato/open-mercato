import { validateSameOriginMutationRequest } from '../originGuard'

describe('validateSameOriginMutationRequest', () => {
  it('allows safe methods without origin headers', () => {
    const req = new Request('https://app.example/api/customers/people', { method: 'GET' })

    expect(validateSameOriginMutationRequest(req)).toBeNull()
  })

  it('allows same-origin unsafe requests', () => {
    const req = new Request('https://app.example/api/customers/people', {
      method: 'POST',
      headers: {
        origin: 'https://app.example',
      },
    })

    expect(validateSameOriginMutationRequest(req)).toBeNull()
  })

  it('rejects cross-origin unsafe requests', () => {
    const req = new Request('https://app.example/api/customers/people', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
      },
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({ reason: 'origin-mismatch' })
  })

  it('rejects browser requests marked as cross-site', () => {
    const req = new Request('https://app.example/api/customers/people', {
      method: 'PUT',
      headers: {
        'sec-fetch-site': 'cross-site',
      },
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({ reason: 'cross-site-fetch' })
  })

  it('falls back to referer when origin is absent', () => {
    const req = new Request('https://app.example/api/customers/people', {
      method: 'DELETE',
      headers: {
        referer: 'https://evil.example/page',
      },
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({ reason: 'referer-mismatch' })
  })
})
