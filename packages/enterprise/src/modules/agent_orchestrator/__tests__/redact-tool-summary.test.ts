/**
 * The MCP contract tells the model to pass `_sessionToken` in every tool call,
 * and trace ingestion stored raw tool arguments verbatim — so a live credential
 * reached `agent_tool_calls.request_summary`, which the trace detail page shows
 * to any holder of `trace.view` (granted to `employee` by default).
 */
import { isSecretKey, redactSecrets, REDACTED_PLACEHOLDER } from '../lib/trace/redactToolSummary'

describe('tool-summary secret redaction', () => {
  it('redacts the session token the MCP contract injects', () => {
    const summary = { _sessionToken: 'sess_abc123', query: 'find customer Taylor' }
    expect(redactSecrets(summary)).toEqual({
      _sessionToken: REDACTED_PLACEHOLDER,
      query: 'find customer Taylor',
    })
  })

  it('matches the same name in every casing the wire uses', () => {
    for (const key of ['_sessionToken', 'sessionToken', 'session_token', 'SESSION_TOKEN']) {
      expect(isSecretKey(key)).toBe(true)
    }
  })

  it('redacts nested and array-held secrets', () => {
    const summary = {
      calls: [{ apiKey: 'omk_live', path: '/api/x' }],
      nested: { auth: { authorization: 'Bearer abc' } },
    }
    expect(redactSecrets(summary)).toEqual({
      calls: [{ apiKey: REDACTED_PLACEHOLDER, path: '/api/x' }],
      nested: { auth: REDACTED_PLACEHOLDER },
    })
  })

  it('leaves ordinary arguments intact — a trace exists to be debugged from', () => {
    const summary = { query: 'orders', limit: 20, tokenCount: 512, keyword: 'x', enabled: false }
    expect(redactSecrets(summary)).toEqual(summary)
    for (const key of ['query', 'limit', 'tokenCount', 'keyword', 'enabled', 'tokenizer']) {
      expect(isSecretKey(key)).toBe(false)
    }
  })

  it('passes through non-object payloads unchanged', () => {
    expect(redactSecrets('plain text')).toBe('plain text')
    expect(redactSecrets(null)).toBeNull()
    expect(redactSecrets(42)).toBe(42)
  })
})
