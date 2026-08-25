import { describeAgentFailure, redactSecrets } from '../failure-reason'

/**
 * Token-shaped fixtures are assembled at run time rather than written as
 * literals. They are fabricated, but a literal in this shape trips GitHub's
 * secret-scanning push protection, and a test file that cannot be pushed is
 * worse than one that spends a `join` on its fixtures.
 */
const fakeBotToken = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GhIjKl', 'mNoPqRsTuVwXyZ0123456789abcd'].join('.')
const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r5wW1gFWFOEjXk'].join('.')

/**
 * The auto-reply failure marker is persisted on `channelState` and rendered on
 * the settings page, so an upstream error message stops being a log line and
 * becomes product data. These cases pin the two properties that matter: the
 * reason stays useful, and nothing that looks like a credential survives into the
 * column.
 */
describe('redactSecrets', () => {
  it('leaves an ordinary diagnostic alone', () => {
    expect(redactSecrets('agent policy denied: missing customers.view')).toBe(
      'agent policy denied: missing customers.view',
    )
  })

  it('strips a bot token quoted in an Authorization header', () => {
    const redacted = redactSecrets(`Discord API 401: Authorization: Bot ${fakeBotToken}`)
    expect(redacted).not.toContain(fakeBotToken)
    expect(redacted).toContain('[redacted]')
  })

  it('strips a bare token-shaped value with no header around it', () => {
    expect(redactSecrets(`rejected ${fakeJwt}`)).toBe('rejected [redacted]')
  })

  it('strips a provider api key prefix', () => {
    expect(redactSecrets('bad key sk-abcdefghijklmnopqrstuvwxyz')).toBe('bad key [redacted]')
  })

  it('keeps the query parameter name but not its value', () => {
    expect(redactSecrets('GET https://example.test/x?access_token=abc123&page=2')).toBe(
      'GET https://example.test/x?access_token=[redacted]&page=2',
    )
  })
})

describe('describeAgentFailure', () => {
  it('names the agent, because that is what the operator has to change', () => {
    expect(describeAgentFailure('customers.support', new Error('agent_features_denied'))).toBe(
      'agent customers.support: agent_features_denied',
    )
  })

  it('keeps only the first line, so a stack trace never lands in the column', () => {
    const err = new Error('boom\n    at somewhere (file.ts:1:1)\n    at elsewhere (file.ts:2:2)')
    expect(describeAgentFailure('a.b', err)).toBe('agent a.b: boom')
  })

  it('survives a thrown non-Error', () => {
    expect(describeAgentFailure('a.b', 'plain string')).toBe('agent a.b: plain string')
    expect(describeAgentFailure('a.b', new Error(''))).toBe('agent a.b: unknown error')
  })

  it('redacts a credential the upstream error echoed back', () => {
    const err = new Error('POST /channels/1/messages failed: Bearer sk-0123456789abcdefghij')
    expect(describeAgentFailure('a.b', err)).not.toContain('0123456789abcdefghij')
  })
})
