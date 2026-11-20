import { createHash } from 'node:crypto'
import {
  DEFAULT_TRACE_CONTENT_MAX_BYTES,
  LLM_REQUEST_ARTIFACT_SCHEMA,
  LLM_RESPONSE_ARTIFACT_SCHEMA,
  buildLlmRequestArtifact,
  buildLlmResponseArtifact,
  resolveTraceContentMaxBytes,
  type LlmRequestCallInput,
} from '../lib/trace/contentCapture'
import { passesIbanChecksum, passesLuhn, redactPiiStrings, redactSecretStrings } from '../lib/trace/redactStrings'

function requestCall(overrides: Partial<LlmRequestCallInput> = {}): LlmRequestCallInput {
  return {
    provider: 'anthropic',
    modelId: 'test-model',
    system: 'You are a helper.\n[Session Authorization: sess_live_abc123]',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Mail jan.kowalski@example.com, header Authorization: Bearer abc.def.ghi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { query: 'acme', _sessionToken: 'tok-1' } }],
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'lookup',
        description: 'Find a record',
        inputSchema: { type: 'object', properties: { password: { type: 'string' } } },
      },
    ],
    responseFormat: { type: 'text' },
    callSettings: { temperature: 0.2, providerOptions: { openai: { apiKey: 'sk-secret', reasoningEffort: 'low' } } },
    ...overrides,
  }
}

function serialized(value: unknown): string {
  return JSON.stringify(value)
}

describe('buildLlmRequestArtifact', () => {
  it('builds the llm_request.v1 shape with secrets redacted', () => {
    const artifact = buildLlmRequestArtifact(requestCall(), { redactPii: false })
    const text = serialized(artifact.payload)
    expect(artifact.payload).toMatchObject({
      schema: LLM_REQUEST_ARTIFACT_SCHEMA,
      provider: 'anthropic',
      modelId: 'test-model',
      tools: [{ name: 'lookup', description: 'Find a record' }],
      responseFormat: { type: 'text' },
    })
    expect(text).not.toContain('sess_live_abc123')
    expect(text).not.toContain('abc.def.ghi')
    expect(text).not.toContain('tok-1')
    expect(text).not.toContain('sk-secret')
    expect(text).toContain('reasoningEffort')
    expect(text).toContain('jan.kowalski@example.com')
    expect(text).toContain('"password":{"type":"string"}')
    expect(artifact.truncated).toBe(false)
    expect(artifact.bytes).toBe(Buffer.byteLength(text, 'utf8'))
    const rules = artifact.redactions.map((entry) => entry.rule)
    expect(rules).toEqual([...rules].sort())
    expect(rules).toEqual(expect.arrayContaining(['session_authorization', 'secret_key']))
    expect(rules).not.toContain('email')
  })

  it('redacts emails only when redactPii is enabled', () => {
    const artifact = buildLlmRequestArtifact(requestCall(), { redactPii: true })
    const text = serialized(artifact.payload)
    expect(text).not.toContain('jan.kowalski@example.com')
    expect(text).toContain('[redacted-email]')
    expect(artifact.redactions).toContainEqual({ rule: 'email', count: 1 })
  })

  it('replaces file parts with a hash summary and never stores the data', () => {
    const bytes = Buffer.from('binary-image-content')
    const base64 = bytes.toString('base64')
    const artifact = buildLlmRequestArtifact(
      requestCall({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'file', mediaType: 'image/png', data: base64 },
              { type: 'image', image: new Uint8Array(bytes), mimeType: 'image/jpeg' },
            ],
          },
        ],
      }),
      { redactPii: false },
    )
    const expectedSha = createHash('sha256').update(bytes).digest('hex')
    expect(serialized(artifact.payload)).not.toContain(base64)
    expect(artifact.payload).toMatchObject({
      messages: [
        {
          content: [
            { type: 'file', mediaType: 'image/png', bytes: bytes.byteLength, sha256: expectedSha },
            { type: 'file', mediaType: 'image/jpeg', bytes: bytes.byteLength, sha256: expectedSha },
          ],
        },
      ],
    })
  })

  it('truncates the largest message content first and respects the cap', () => {
    const large = 'x'.repeat(5000)
    const medium = 'y'.repeat(1500)
    const artifact = buildLlmRequestArtifact(
      requestCall({
        system: 'short',
        messages: [
          { role: 'user', content: medium },
          { role: 'user', content: large },
        ],
      }),
      { redactPii: false, maxBytes: 3000 },
    )
    expect(artifact.truncated).toBe(true)
    expect(artifact.bytes).toBeLessThanOrEqual(3000)
    expect(artifact.bytes).toBe(Buffer.byteLength(serialized(artifact.payload), 'utf8'))
    expect(artifact.payload).toMatchObject({
      messages: [
        { role: 'user', content: medium },
        { role: 'user', content: { _truncated: true, originalBytes: Buffer.byteLength(JSON.stringify(large)) } },
      ],
    })
  })

  it('falls back to a schema-only marker when nothing else fits', () => {
    const artifact = buildLlmRequestArtifact(requestCall(), { redactPii: false, maxBytes: 80 })
    expect(artifact.truncated).toBe(true)
    expect(artifact.bytes).toBeLessThanOrEqual(80)
    expect(artifact.payload).toMatchObject({ schema: LLM_REQUEST_ARTIFACT_SCHEMA, _truncated: true })
  })

  it('produces identical output for identical input', () => {
    const first = buildLlmRequestArtifact(requestCall(), { redactPii: true })
    const second = buildLlmRequestArtifact(requestCall(), { redactPii: true })
    expect(serialized(first)).toBe(serialized(second))
  })

  it('does not mutate the input call', () => {
    const call = requestCall()
    const before = serialized(call)
    buildLlmRequestArtifact(call, { redactPii: true, maxBytes: 200 })
    expect(serialized(call)).toBe(before)
  })
})

describe('buildLlmResponseArtifact', () => {
  it('builds the llm_response.v1 shape with optional fields', () => {
    const artifact = buildLlmResponseArtifact(
      {
        finishReason: 'stop',
        content: [{ type: 'text', text: 'Done. Card 4111 1111 1111 1111 noted.' }],
        object: { status: 'ok' },
        usage: { inputTokens: 10, outputTokens: 4 },
        providerMetadata: { openai: { accessToken: 'secret-value' } },
      },
      { redactPii: true },
    )
    expect(artifact.payload).toMatchObject({
      schema: LLM_RESPONSE_ARTIFACT_SCHEMA,
      finishReason: 'stop',
      content: [{ type: 'text', text: 'Done. Card [redacted-card] noted.' }],
      object: { status: 'ok' },
      usage: { inputTokens: 10, outputTokens: 4 },
      providerMetadata: { openai: { accessToken: '[redacted]' } },
    })
    expect(artifact.redactions).toEqual([
      { rule: 'card', count: 1 },
      { rule: 'secret_key', count: 1 },
    ])
  })

  it('omits object and providerMetadata when absent', () => {
    const artifact = buildLlmResponseArtifact(
      { finishReason: 'stop', content: [], usage: {} },
      { redactPii: false },
    )
    expect(artifact.payload).not.toHaveProperty('object')
    expect(artifact.payload).not.toHaveProperty('providerMetadata')
  })
})

describe('redactPiiStrings', () => {
  it('redacts only Luhn-valid card numbers', () => {
    expect(passesLuhn('4111111111111111')).toBe(true)
    expect(passesLuhn('4111111111111112')).toBe(false)
    const result = redactPiiStrings('valid 4111-1111-1111-1111 invalid 4111 1111 1111 1112')
    expect(result.text).toBe('valid [redacted-card] invalid 4111 1111 1111 1112')
    expect(result.counts).toEqual({ card: 1 })
  })

  it('redacts checksum-valid IBANs and international phone numbers', () => {
    expect(passesIbanChecksum('GB82 WEST 1234 5698 7654 32')).toBe(true)
    expect(passesIbanChecksum('GB82 WEST 1234 5698 7654 33')).toBe(false)
    const result = redactPiiStrings('Pay GB82 WEST 1234 5698 7654 32 or call +48 601 234 567 by order 2026-10-28')
    expect(result.text).toBe('Pay [redacted-iban] or call [redacted-phone] by order 2026-10-28')
    expect(result.counts).toEqual({ iban: 1, phone: 1 })
  })

  it('keeps redactSecretStrings behavior for session and bearer tokens', () => {
    const sessionLine = redactSecretStrings('[Session Authorization: sess_live_abc123]')
    expect(sessionLine).not.toContain('sess_live_abc123')
    expect(sessionLine).toContain('Session Authorization: [redacted]')
    expect(redactSecretStrings('use Bearer abc.def.ghi now')).toBe('use Bearer [redacted] now')
  })
})

describe('resolveTraceContentMaxBytes', () => {
  it('reads a positive integer and falls back on malformed values', () => {
    expect(resolveTraceContentMaxBytes({})).toBe(DEFAULT_TRACE_CONTENT_MAX_BYTES)
    expect(resolveTraceContentMaxBytes({ OM_AGENT_TRACE_CONTENT_MAX_BYTES: '2048' })).toBe(2048)
    expect(resolveTraceContentMaxBytes({ OM_AGENT_TRACE_CONTENT_MAX_BYTES: '-5' })).toBe(DEFAULT_TRACE_CONTENT_MAX_BYTES)
    expect(resolveTraceContentMaxBytes({ OM_AGENT_TRACE_CONTENT_MAX_BYTES: '1e6' })).toBe(DEFAULT_TRACE_CONTENT_MAX_BYTES)
    expect(resolveTraceContentMaxBytes({ OM_AGENT_TRACE_CONTENT_MAX_BYTES: '0' })).toBe(DEFAULT_TRACE_CONTENT_MAX_BYTES)
  })
})
