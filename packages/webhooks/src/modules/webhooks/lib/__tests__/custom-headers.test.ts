import {
  WEBHOOK_REDACTED_HEADER_VALUE as REDACTED,
  isCredentialWebhookHeader,
  planWebhookCustomHeadersUpdate,
  redactWebhookCustomHeaders,
  resolveRedactedWebhookCustomHeaders,
} from '../custom-headers'

describe('isCredentialWebhookHeader', () => {
  it.each([
    'Authorization',
    'Proxy-Authorization',
    'X-API-Key',
    'x-mock-webhook-token',
    'X-Signature',
    'x-sig',
    'x-session-id',
    'Cookie',
    'X-Client-Secret',
    'x-pass',
    'X-Functions-Key',
    'Ocp-Apim-Subscription-Key',
    'X-Hub-Hmac',
  ])('treats %s as a credential header', (name) => {
    expect(isCredentialWebhookHeader(name, 'value')).toBe(true)
  })

  it.each(['x-source', 'x-environment', 'accept-language', 'x-tenant'])('keeps %s readable', (name) => {
    expect(isCredentialWebhookHeader(name, 'plain')).toBe(false)
  })

  it.each([
    'Bearer abc',
    'basic dXNlcjpwYXNz',
    'eyJhbGciOiJIUzI1NiJ9.e30.sig',
    'sk_live_123',
    'ghp_abc',
    'xoxb-123',
    'glpat-abc',
  ])('treats a neutral header name with value %s as a credential', (value) => {
    expect(isCredentialWebhookHeader('x-forward', value)).toBe(true)
  })
})

describe('redactWebhookCustomHeaders', () => {
  it('masks credential values and keeps names and other values', () => {
    expect(redactWebhookCustomHeaders({ Authorization: 'Bearer t', 'x-source': 'qa' })).toEqual({
      Authorization: REDACTED,
      'x-source': 'qa',
    })
  })

  it('returns null for missing headers', () => {
    expect(redactWebhookCustomHeaders(null)).toBeNull()
    expect(redactWebhookCustomHeaders(undefined)).toBeNull()
  })
})

describe('resolveRedactedWebhookCustomHeaders', () => {
  const stored = { Authorization: 'Bearer t', 'x-source': 'qa' }

  it('restores marked values from storage under the incoming key', () => {
    expect(resolveRedactedWebhookCustomHeaders({ authorization: REDACTED, 'x-source': 'erp' }, stored)).toEqual({
      ok: true,
      headers: { authorization: 'Bearer t', 'x-source': 'erp' },
      keptStoredValues: ['authorization'],
    })
  })

  it('rejects a marker without a stored value', () => {
    expect(resolveRedactedWebhookCustomHeaders({ 'x-token': REDACTED }, stored)).toEqual({ ok: false, header: 'x-token' })
    expect(resolveRedactedWebhookCustomHeaders({ 'x-token': REDACTED }, null)).toEqual({ ok: false, header: 'x-token' })
  })

  it('prefers an exact key over a case-insensitive match', () => {
    const result = resolveRedactedWebhookCustomHeaders(
      { authorization: REDACTED },
      { Authorization: 'Bearer upper', authorization: 'Bearer lower' },
    )
    expect(result).toEqual({ ok: true, headers: { authorization: 'Bearer lower' }, keptStoredValues: ['authorization'] })
  })

  it('never resolves a marker to a stored marker', () => {
    expect(resolveRedactedWebhookCustomHeaders({ Authorization: REDACTED }, { Authorization: REDACTED })).toEqual({
      ok: false,
      header: 'Authorization',
    })
  })
})

describe('planWebhookCustomHeadersUpdate', () => {
  const current = { url: 'https://example.com/hook', customHeaders: { Authorization: 'Bearer t', 'x-source': 'qa' } }

  it('leaves headers untouched when they are not part of the update', () => {
    expect(planWebhookCustomHeadersUpdate({ current, next: { url: current.url }, canRevealCredentials: false })).toEqual({
      ok: true,
      customHeaders: undefined,
    })
  })

  it('refuses to carry stored credentials to a new URL without webhooks.secrets', () => {
    expect(planWebhookCustomHeadersUpdate({ current, next: { url: 'https://evil.example.net/' }, canRevealCredentials: false })).toEqual({
      ok: false,
      reason: 'credentialHeadersRequireReentry',
      header: 'Authorization',
    })
  })

  it('allows a new URL when the stored headers carry no credential', () => {
    expect(
      planWebhookCustomHeadersUpdate({
        current: { url: current.url, customHeaders: { 'x-source': 'qa' } },
        next: { url: 'https://other.example.net/' },
        canRevealCredentials: false,
      }),
    ).toEqual({ ok: true, customHeaders: undefined })
  })

  it('treats a path change on the same host as a URL change', () => {
    expect(
      planWebhookCustomHeadersUpdate({
        current,
        next: { url: 'https://example.com/other-bin', customHeaders: { Authorization: REDACTED } },
        canRevealCredentials: false,
      }),
    ).toMatchObject({ ok: false, reason: 'credentialHeadersRequireReentry' })
  })

  it('does not count a non-credential header sent back as the marker', () => {
    expect(
      planWebhookCustomHeadersUpdate({
        current,
        next: { url: 'https://other.example.net/', customHeaders: { 'x-source': REDACTED } },
        canRevealCredentials: false,
      }),
    ).toEqual({ ok: true, customHeaders: { 'x-source': 'qa' } })
  })

  it('allows clearing headers on a new URL', () => {
    expect(
      planWebhookCustomHeadersUpdate({ current, next: { url: 'https://other.example.net/', customHeaders: null }, canRevealCredentials: false }),
    ).toEqual({ ok: true, customHeaders: null })
  })
})
