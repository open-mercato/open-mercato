jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: () => mocked }
})

const reportErrorMock = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

import {
  MCP_AUDIT_RESOURCE_KIND,
  MCP_AUDIT_WRITE_TIMEOUT_MS,
  buildMcpAuditAccessLogInput,
  extractArgKeys,
  mapToolResultToAuditOutcome,
  recordMcpToolCall,
  resolveCorrelationId,
  type McpToolCallAuditEntry,
} from '../mcp-audit'

const loggerMock = jest
  .requireMock('@open-mercato/shared/lib/logger')
  .createLogger('test') as Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function makeEntry(overrides: Partial<McpToolCallAuditEntry> = {}): McpToolCallAuditEntry {
  return {
    toolName: 'customers.list_people',
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    sessionUserId: null,
    apiKeySessionUserId: null,
    apiKeyCreatedBy: '33333333-3333-4333-8333-333333333333',
    channel: 'mcp',
    mcpServer: 'http',
    apiKeyId: 'key-1',
    sessionKeyId: null,
    principal: 'api_key',
    outcome: 'ok',
    durationMs: 42,
    isMutation: false,
    correlationId: 'corr-1',
    args: {
      query: 'secret-search-term',
      email: 'person@example.com',
      _sessionToken: 'sess_abcdef0123456789abcdef0123456789',
    },
    ...overrides,
  }
}

function makeContainer(service: unknown) {
  return {
    resolve: jest.fn(<T,>(name: string): T => {
      if (name !== 'accessLogService') throw new Error(`[internal] unexpected ${name}`)
      if (service === undefined) throw new Error('[internal] not registered')
      return service as T
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('extractArgKeys', () => {
  it('returns top-level keys without _sessionToken', () => {
    expect(extractArgKeys({ alpha: 1, beta: { nested: 2 }, _sessionToken: 'sess_x' })).toEqual(['alpha', 'beta'])
  })

  it('returns an empty list for non-object input', () => {
    expect(extractArgKeys(null)).toEqual([])
    expect(extractArgKeys('text')).toEqual([])
    expect(extractArgKeys([1, 2])).toEqual([])
  })
})

describe('resolveCorrelationId', () => {
  it('accepts a safe header value', () => {
    expect(resolveCorrelationId('req-abc_1.2:3')).toBe('req-abc_1.2:3')
  })

  it('generates a uuid for missing, empty, oversized, or unsafe values', () => {
    expect(resolveCorrelationId(undefined)).toMatch(UUID_PATTERN)
    expect(resolveCorrelationId(null)).toMatch(UUID_PATTERN)
    expect(resolveCorrelationId('   ')).toMatch(UUID_PATTERN)
    expect(resolveCorrelationId('a'.repeat(129))).toMatch(UUID_PATTERN)
    expect(resolveCorrelationId('bad value\n')).toMatch(UUID_PATTERN)
    expect(resolveCorrelationId('<script>')).toMatch(UUID_PATTERN)
  })

  it('accepts a value at the 128 character limit', () => {
    const value = 'b'.repeat(128)
    expect(resolveCorrelationId(value)).toBe(value)
  })
})

describe('mapToolResultToAuditOutcome', () => {
  it('maps success to ok', () => {
    expect(mapToolResultToAuditOutcome({ success: true, result: {} })).toBe('ok')
  })

  it('maps known error codes', () => {
    expect(mapToolResultToAuditOutcome({ success: false, errorCode: 'UNAUTHORIZED' })).toBe('denied')
    expect(mapToolResultToAuditOutcome({ success: false, errorCode: 'NOT_FOUND' })).toBe('denied')
    expect(mapToolResultToAuditOutcome({ success: false, errorCode: 'VALIDATION_ERROR' })).toBe('invalid_input')
    expect(mapToolResultToAuditOutcome({ success: false, errorCode: 'EXECUTION_ERROR' })).toBe('error')
  })

  it('falls back to error when no code is present', () => {
    expect(mapToolResultToAuditOutcome({ success: false })).toBe('error')
  })

  it('maps a pending approval result', () => {
    expect(mapToolResultToAuditOutcome({ success: false, pendingApproval: { id: 'pa-1' } })).toBe('pending_approval')
  })
})

describe('buildMcpAuditAccessLogInput', () => {
  it('never includes argument values', () => {
    const input = buildMcpAuditAccessLogInput(makeEntry())
    const serialized = JSON.stringify(input)
    expect(serialized).not.toContain('secret-search-term')
    expect(serialized).not.toContain('person@example.com')
    expect(serialized).not.toContain('sess_abcdef')
    expect(serialized).not.toContain('_sessionToken')
    expect(input.context.argKeys).toEqual(['query', 'email'])
  })

  it('builds the access log row shape', () => {
    const input = buildMcpAuditAccessLogInput(makeEntry())
    expect(input).toMatchObject({
      resourceKind: MCP_AUDIT_RESOURCE_KIND,
      resourceId: 'customers.list_people',
      accessType: 'call',
      actorUserId: '33333333-3333-4333-8333-333333333333',
    })
    expect(input.context).toMatchObject({
      channel: 'mcp',
      mcpServer: 'http',
      principal: 'api_key',
      outcome: 'ok',
      durationMs: 42,
      correlationId: 'corr-1',
    })
  })

  it('prefers the session user, then the api key session user', () => {
    expect(
      buildMcpAuditAccessLogInput(makeEntry({ sessionUserId: 'user-a', apiKeySessionUserId: 'user-b' })).actorUserId,
    ).toBe('user-a')
    expect(buildMcpAuditAccessLogInput(makeEntry({ apiKeySessionUserId: 'user-b' })).actorUserId).toBe('user-b')
  })
})

describe('recordMcpToolCall', () => {
  it('writes one row with keys only', async () => {
    const log = jest.fn().mockResolvedValue({ id: 'row-1' })
    await recordMcpToolCall(makeContainer({ log }), makeEntry())
    expect(log).toHaveBeenCalledTimes(1)
    const payload = JSON.stringify(log.mock.calls[0][0])
    expect(payload).not.toContain('secret-search-term')
    expect(payload).not.toContain('sess_abcdef')
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('does not throw when the service is missing', async () => {
    await expect(recordMcpToolCall(makeContainer(undefined), makeEntry())).resolves.toBeUndefined()
    await expect(recordMcpToolCall(undefined, makeEntry())).resolves.toBeUndefined()
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('does not throw and warns when the service throws', async () => {
    const log = jest.fn().mockRejectedValue(new Error('db down'))
    await expect(recordMcpToolCall(makeContainer({ log }), makeEntry())).resolves.toBeUndefined()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'MCP tool-call audit write failed',
      expect.objectContaining({ correlationId: 'corr-1' }),
    )
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'ai_assistant.mcp_audit_write_failed' }),
    )
  })

  it('does not throw when the service throws synchronously', async () => {
    const log = jest.fn(() => {
      throw new Error('sync failure')
    })
    await expect(recordMcpToolCall(makeContainer({ log }), makeEntry())).resolves.toBeUndefined()
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  describe('with fake timers', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('abandons a slow write after the bound', async () => {
      const log = jest.fn(() => new Promise<never>(() => undefined))
      const pending = recordMcpToolCall(makeContainer({ log }), makeEntry())
      await jest.advanceTimersByTimeAsync(MCP_AUDIT_WRITE_TIMEOUT_MS)
      await expect(pending).resolves.toBeUndefined()
      expect(loggerMock.warn).toHaveBeenCalledWith(
        'MCP tool-call audit write abandoned after timeout',
        expect.objectContaining({ correlationId: 'corr-1', timeoutMs: MCP_AUDIT_WRITE_TIMEOUT_MS }),
      )
    })
  })
})
