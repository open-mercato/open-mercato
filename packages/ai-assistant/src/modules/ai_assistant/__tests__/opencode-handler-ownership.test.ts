/**
 * Cross-user OpenCode session resume / answerQuestion ownership coverage.
 *
 * These tests exercise the security fix from
 * `.ai/specs/2026-05-23-fix-opencode-session-ownership.md`:
 *
 *   1. The streaming handler refuses to resume an OpenCode session whose
 *      api_key binding does not match the auth triple.
 *   2. The streaming handler fails closed when auth/em is missing on a
 *      resume.
 *   3. `handleOpenCodeAnswer` refuses to answer questions for sessions
 *      owned by another user / tenant / org and for stale/unknown question
 *      ids.
 *   4. `getOwnedPendingQuestions` only returns the caller's questions.
 *
 * The OpenCode client is mocked via `jest.mock('../lib/opencode-client', ...)`
 * so no real HTTP traffic occurs. The api_key lookup is mocked at the
 * service module boundary.
 */

const mockOpenCodeClient = {
  getSession: jest.fn(),
  createSession: jest.fn(),
  sendMessage: jest.fn(),
  subscribeToEvents: jest.fn(),
  getSessionStatus: jest.fn(),
  getPendingQuestions: jest.fn(),
  answerQuestion: jest.fn(),
}

jest.mock('../lib/opencode-client', () => ({
  createOpenCodeClient: () => mockOpenCodeClient,
}))

const mockFindApiKeyByOpencodeSessionId = jest.fn()

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  __esModule: true,
  findApiKeyByOpencodeSessionId: (...args: unknown[]) =>
    mockFindApiKeyByOpencodeSessionId(...args),
}))

import {
  handleOpenCodeMessage,
  handleOpenCodeMessageStreaming,
  handleOpenCodeAnswer,
  getOwnedPendingQuestions,
  OpenCodeSessionOwnershipError,
  type OpenCodeAuthContext,
  type OpenCodeStreamEvent,
} from '../lib/opencode-handlers'

const aliceAuth: OpenCodeAuthContext = {
  userId: 'user-alice',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const bobAuth: OpenCodeAuthContext = {
  userId: 'user-bob',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const aliceOtherTenant: OpenCodeAuthContext = {
  userId: 'user-alice',
  tenantId: 'tenant-2',
  organizationId: 'org-1',
}

const aliceOtherOrg: OpenCodeAuthContext = {
  userId: 'user-alice',
  tenantId: 'tenant-1',
  organizationId: 'org-2',
}

const fakeEm = {} as any

function aliceRow(opencodeSessionId: string) {
  return {
    id: 'api-key-1',
    sessionUserId: aliceAuth.userId,
    tenantId: aliceAuth.tenantId,
    organizationId: aliceAuth.organizationId,
    opencodeSessionId,
    expiresAt: null,
    deletedAt: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOpenCodeClient.subscribeToEvents.mockReturnValue(() => undefined)
})

describe('handleOpenCodeMessage — resume ownership guard', () => {
  it('proceeds when the api_key row matches the auth triple', async () => {
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))
    mockOpenCodeClient.getSession.mockResolvedValueOnce({ id: 'ses_alice' })
    mockOpenCodeClient.sendMessage.mockResolvedValueOnce({ ok: true })

    const result = await handleOpenCodeMessage({
      message: 'hi',
      sessionId: 'ses_alice',
      auth: aliceAuth,
      em: fakeEm,
    })

    expect(result.sessionId).toBe('ses_alice')
    expect(mockOpenCodeClient.getSession).toHaveBeenCalledWith('ses_alice')
  })

  it('throws OpenCodeSessionOwnershipError when sessionUserId mismatches', async () => {
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))

    await expect(
      handleOpenCodeMessage({
        message: 'hi',
        sessionId: 'ses_alice',
        auth: bobAuth,
        em: fakeEm,
      })
    ).rejects.toBeInstanceOf(OpenCodeSessionOwnershipError)
    expect(mockOpenCodeClient.getSession).not.toHaveBeenCalled()
  })

  it('throws OpenCodeSessionOwnershipError when tenantId mismatches', async () => {
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))

    await expect(
      handleOpenCodeMessage({
        message: 'hi',
        sessionId: 'ses_alice',
        auth: aliceOtherTenant,
        em: fakeEm,
      })
    ).rejects.toBeInstanceOf(OpenCodeSessionOwnershipError)
  })

  it('throws OpenCodeSessionOwnershipError when organizationId mismatches', async () => {
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))

    await expect(
      handleOpenCodeMessage({
        message: 'hi',
        sessionId: 'ses_alice',
        auth: aliceOtherOrg,
        em: fakeEm,
      })
    ).rejects.toBeInstanceOf(OpenCodeSessionOwnershipError)
  })

  it('throws OpenCodeSessionOwnershipError when no api_key row is bound', async () => {
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(null)

    await expect(
      handleOpenCodeMessage({
        message: 'hi',
        sessionId: 'ses_alice',
        auth: aliceAuth,
        em: fakeEm,
      })
    ).rejects.toMatchObject({
      name: 'OpenCodeSessionOwnershipError',
      code: 'session_unbound',
    })
  })

  it('creates a fresh session when no sessionId is supplied (no ownership check needed)', async () => {
    mockOpenCodeClient.createSession.mockResolvedValueOnce({ id: 'ses_new' })
    mockOpenCodeClient.sendMessage.mockResolvedValueOnce({ ok: true })

    const result = await handleOpenCodeMessage({
      message: 'hi',
      auth: aliceAuth,
      em: fakeEm,
    })

    expect(result.sessionId).toBe('ses_new')
    expect(mockFindApiKeyByOpencodeSessionId).not.toHaveBeenCalled()
    expect(mockOpenCodeClient.createSession).toHaveBeenCalled()
  })
})

describe('handleOpenCodeMessageStreaming — resume ownership guard', () => {
  it('emits an error and returns early when ownership check fails', async () => {
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))
    const events: OpenCodeStreamEvent[] = []

    await handleOpenCodeMessageStreaming(
      {
        message: 'hi',
        sessionId: 'ses_alice',
        auth: bobAuth,
        em: fakeEm,
      },
      async (event) => {
        events.push(event)
      }
    )

    expect(events).toContainEqual({ type: 'error', error: 'Session not available' })
    expect(mockOpenCodeClient.getSession).not.toHaveBeenCalled()
  })

  it('emits an opaque error when auth/em is missing on a resume', async () => {
    const events: OpenCodeStreamEvent[] = []

    await handleOpenCodeMessageStreaming(
      {
        message: 'hi',
        sessionId: 'ses_alice',
      },
      async (event) => {
        events.push(event)
      }
    )

    expect(events).toContainEqual({ type: 'error', error: 'Session not available' })
    expect(mockOpenCodeClient.getSession).not.toHaveBeenCalled()
  })
})

describe('handleOpenCodeAnswer — question ownership guard', () => {
  it('proceeds when the question belongs to the caller', async () => {
    mockOpenCodeClient.getPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])
    mockOpenCodeClient.answerQuestion.mockResolvedValueOnce(undefined)
    mockOpenCodeClient.getSessionStatus.mockResolvedValueOnce({ status: 'idle' })
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))

    const events: OpenCodeStreamEvent[] = []
    await handleOpenCodeAnswer('q-1', 0, 'ses_alice', async (e) => {
      events.push(e)
    }, { auth: aliceAuth, em: fakeEm })

    expect(mockOpenCodeClient.answerQuestion).toHaveBeenCalledWith('q-1', 0)
    expect(events.some((e) => e.type === 'thinking')).toBe(true)
  })

  it('refuses when the question belongs to a different user', async () => {
    mockOpenCodeClient.getPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])
    mockFindApiKeyByOpencodeSessionId.mockResolvedValueOnce(aliceRow('ses_alice'))

    const events: OpenCodeStreamEvent[] = []
    await handleOpenCodeAnswer('q-1', 0, 'ses_alice', async (e) => {
      events.push(e)
    }, { auth: bobAuth, em: fakeEm })

    expect(mockOpenCodeClient.answerQuestion).not.toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'error', error: 'Session not available' })
  })

  it('refuses when the question id is unknown', async () => {
    mockOpenCodeClient.getPendingQuestions.mockResolvedValueOnce([])

    const events: OpenCodeStreamEvent[] = []
    await handleOpenCodeAnswer('q-unknown', 0, 'ses_alice', async (e) => {
      events.push(e)
    }, { auth: aliceAuth, em: fakeEm })

    expect(mockOpenCodeClient.answerQuestion).not.toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'error', error: 'Session not available' })
  })

  it('refuses when the caller-supplied sessionId does not own the question', async () => {
    mockOpenCodeClient.getPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])

    const events: OpenCodeStreamEvent[] = []
    await handleOpenCodeAnswer('q-1', 0, 'ses_other', async (e) => {
      events.push(e)
    }, { auth: aliceAuth, em: fakeEm })

    expect(mockOpenCodeClient.answerQuestion).not.toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'error', error: 'Session not available' })
  })

  it('refuses when ownership context is missing entirely', async () => {
    mockOpenCodeClient.getPendingQuestions.mockResolvedValueOnce([
      { id: 'q-1', sessionID: 'ses_alice' },
    ])

    const events: OpenCodeStreamEvent[] = []
    await handleOpenCodeAnswer('q-1', 0, 'ses_alice', async (e) => {
      events.push(e)
    })

    expect(mockOpenCodeClient.answerQuestion).not.toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'error', error: 'Session not available' })
  })
})

describe('getOwnedPendingQuestions', () => {
  it('returns only questions whose sessions are owned by the auth triple', async () => {
    mockOpenCodeClient.getPendingQuestions.mockResolvedValueOnce([
      { id: 'q-alice', sessionID: 'ses_alice' },
      { id: 'q-bob', sessionID: 'ses_bob' },
      { id: 'q-orphan', sessionID: 'ses_orphan' },
    ])
    mockFindApiKeyByOpencodeSessionId.mockImplementation(async (_em: unknown, id: string) => {
      if (id === 'ses_alice') return aliceRow('ses_alice')
      if (id === 'ses_bob') {
        return {
          ...aliceRow('ses_bob'),
          sessionUserId: 'user-bob',
        }
      }
      return null
    })

    const owned = await getOwnedPendingQuestions(fakeEm, aliceAuth)

    expect(owned).toEqual([{ id: 'q-alice', sessionID: 'ses_alice' }])
  })
})
