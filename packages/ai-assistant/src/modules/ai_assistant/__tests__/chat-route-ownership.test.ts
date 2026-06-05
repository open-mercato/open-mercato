/**
 * Chat-route wiring tests for the OpenCode session ownership fix
 * (see `.ai/specs/2026-05-24-fix-opencode-session-ownership.md`).
 *
 * The handler-level ownership assertions are covered in
 * `opencode-handler-ownership.test.ts`. This file specifically exercises
 * the route's three pieces of unique wire-up:
 *
 *   1. The `answerQuestion` short-circuit's three-step verification:
 *      pending-question lookup, caller-supplied sessionId cross-check,
 *      api_key owner lookup.
 *   2. The post-`done` call to `bindOpencodeSessionToApiKey` when a fresh
 *      session token has just been minted.
 *   3. The `auth + em` payload threaded into
 *      `handleOpenCodeMessageStreaming`.
 */

const mockAuth = {
  sub: 'user-alice',
  tenantId: 'tenant-1',
  orgId: 'org-1',
}

const mockBobAuth = {
  sub: 'user-bob',
  tenantId: 'tenant-1',
  orgId: 'org-1',
}

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGenerateSessionToken = jest.fn()
const mockCreateSessionApiKey = jest.fn()
const mockBindOpencodeSessionToApiKey = jest.fn()
const mockFindApiKeyByOpencodeSessionId = jest.fn()
const mockHandleOpenCodeMessageStreaming = jest.fn()
const mockClientGetPendingQuestions = jest.fn()
const mockClientAnswerQuestion = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  __esModule: true,
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  __esModule: true,
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  __esModule: true,
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  __esModule: true,
  generateSessionToken: (...args: unknown[]) => mockGenerateSessionToken(...args),
  createSessionApiKey: (...args: unknown[]) => mockCreateSessionApiKey(...args),
  bindOpencodeSessionToApiKey: (...args: unknown[]) =>
    mockBindOpencodeSessionToApiKey(...args),
  findApiKeyByOpencodeSessionId: (...args: unknown[]) =>
    mockFindApiKeyByOpencodeSessionId(...args),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  __esModule: true,
  UserRole: class UserRole {},
}))

jest.mock('../lib/opencode-handlers', () => {
  const actual = jest.requireActual('../lib/opencode-handlers')
  return {
    __esModule: true,
    ...actual,
    handleOpenCodeMessageStreaming: (...args: unknown[]) =>
      mockHandleOpenCodeMessageStreaming(...args),
  }
})

jest.mock('../lib/opencode-client', () => ({
  __esModule: true,
  createOpenCodeClient: () => ({
    getPendingQuestions: (...args: unknown[]) => mockClientGetPendingQuestions(...args),
    answerQuestion: (...args: unknown[]) => mockClientAnswerQuestion(...args),
  }),
}))

import { POST } from '../api/chat/route'

function buildRequest(body: Record<string, unknown>): any {
  return {
    json: async () => body,
  }
}

function aliceOwnerRow() {
  return {
    id: 'api-key-1',
    sessionUserId: mockAuth.sub,
    tenantId: mockAuth.tenantId,
    organizationId: mockAuth.orgId,
    opencodeSessionId: 'ses_alice',
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue(mockAuth)
  mockCreateRequestContainer.mockResolvedValue({
    resolve: () => ({ identityCacheKey: 'em' }),
  })
  mockFindWithDecryption.mockResolvedValue([])
  mockGenerateSessionToken.mockReturnValue('sess_alice_token')
  mockCreateSessionApiKey.mockResolvedValue({ keyId: 'api-key-1' })
  mockBindOpencodeSessionToApiKey.mockResolvedValue(undefined)
})

describe('chat route — answerQuestion ownership short-circuit', () => {
  it('returns 403 when the answered question id is unknown to OpenCode', async () => {
    mockClientGetPendingQuestions.mockResolvedValueOnce([])

    const res = await POST(
      buildRequest({
        answerQuestion: {
          questionId: 'q-stale',
          answer: 0,
          sessionId: 'ses_alice',
        },
      })
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Session not available' })
    expect(mockClientAnswerQuestion).not.toHaveBeenCalled()
    expect(mockFindApiKeyByOpencodeSessionId).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller-supplied sessionId does not match the question owner', async () => {
    mockClientGetPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])

    const res = await POST(
      buildRequest({
        answerQuestion: {
          questionId: 'q-1',
          answer: 0,
          sessionId: 'ses_attacker',
        },
      })
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Session not available' })
    expect(mockClientAnswerQuestion).not.toHaveBeenCalled()
    expect(mockFindApiKeyByOpencodeSessionId).not.toHaveBeenCalled()
  })

  it('returns 403 when the api_key owner does not match the authenticated caller', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(mockBobAuth)
    mockClientGetPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceOwnerRow())

    const res = await POST(
      buildRequest({
        answerQuestion: {
          questionId: 'q-1',
          answer: 0,
          sessionId: 'ses_alice',
        },
      })
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Session not available' })
    expect(mockClientAnswerQuestion).not.toHaveBeenCalled()
  })

  it('returns 403 when the api_key row has no live binding', async () => {
    mockClientGetPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(null)

    const res = await POST(
      buildRequest({
        answerQuestion: {
          questionId: 'q-1',
          answer: 0,
          sessionId: 'ses_alice',
        },
      })
    )

    expect(res.status).toBe(403)
    expect(mockClientAnswerQuestion).not.toHaveBeenCalled()
  })

  it('forwards to client.answerQuestion when all three checks pass', async () => {
    mockClientGetPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceOwnerRow())
    mockClientAnswerQuestion.mockResolvedValueOnce(undefined)

    const res = await POST(
      buildRequest({
        answerQuestion: {
          questionId: 'q-1',
          answer: 0,
          sessionId: 'ses_alice',
        },
      })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mockClientAnswerQuestion).toHaveBeenCalledWith('q-1', 0)
  })
})

describe('chat route — streaming branch wires auth + em through to the handler', () => {
  it('passes the OpenCodeAuthContext built from auth.sub/tenantId/orgId', async () => {
    // Make the streaming handler resolve without emitting anything special;
    // we only inspect what it was called with.
    mockHandleOpenCodeMessageStreaming.mockImplementation(async (_req, _onEvent) => {
      return undefined
    })

    const res = await POST(
      buildRequest({
        messages: [{ role: 'user', content: 'hello' }],
        sessionId: 'ses_alice',
      })
    )

    // The streaming branch returns a Response immediately and runs the
    // handler in the background. Give the microtask queue a tick so the
    // background IIFE inside the route can reach the handler call.
    await new Promise((resolve) => setImmediate(resolve))

    expect(res).toBeDefined()
    expect(mockHandleOpenCodeMessageStreaming).toHaveBeenCalled()
    const callArgs = mockHandleOpenCodeMessageStreaming.mock.calls[0]
    const handlerInput = callArgs[0]
    expect(handlerInput).toMatchObject({
      sessionId: 'ses_alice',
      auth: {
        userId: mockAuth.sub,
        tenantId: mockAuth.tenantId,
        organizationId: mockAuth.orgId,
      },
    })
    expect(handlerInput.em).toBeDefined()
  })
})

describe('chat route — post-`done` binding wiring', () => {
  it('calls bindOpencodeSessionToApiKey on a freshly minted session', async () => {
    mockHandleOpenCodeMessageStreaming.mockImplementation(async (_req, onEvent) => {
      await onEvent({ type: 'done', sessionId: 'ses_fresh' })
    })

    await POST(
      buildRequest({
        messages: [{ role: 'user', content: 'hello' }],
      })
    )

    // Allow the background IIFE to flush.
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockGenerateSessionToken).toHaveBeenCalled()
    expect(mockBindOpencodeSessionToApiKey).toHaveBeenCalledWith(
      expect.anything(),
      'sess_alice_token',
      'ses_fresh'
    )
  })

  it('does NOT call bindOpencodeSessionToApiKey when resuming an existing sessionId', async () => {
    mockHandleOpenCodeMessageStreaming.mockImplementation(async (_req, onEvent) => {
      await onEvent({ type: 'done', sessionId: 'ses_alice' })
    })

    await POST(
      buildRequest({
        messages: [{ role: 'user', content: 'hello' }],
        sessionId: 'ses_alice',
      })
    )

    await new Promise((resolve) => setImmediate(resolve))

    expect(mockGenerateSessionToken).not.toHaveBeenCalled()
    expect(mockBindOpencodeSessionToApiKey).not.toHaveBeenCalled()
  })
})
