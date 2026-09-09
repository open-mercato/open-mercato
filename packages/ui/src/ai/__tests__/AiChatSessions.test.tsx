/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  emitOrganizationScopeChanged,
} from '@open-mercato/shared/lib/frontend/organizationEvents'
import {
  AiChatSessionsProvider,
  LEGACY_STORAGE_KEY,
  useAiChatSessions,
} from '../AiChatSessions'

jest.mock('../conversation-store', () => {
  const actual = jest.requireActual('../conversation-store') as Record<string, unknown>
  return {
    ...actual,
    listAiServerConversations: jest.fn(async () => null),
    createAiServerConversation: jest.fn(async () => null),
    updateAiServerConversation: jest.fn(async () => null),
  }
})

jest.mock('../useAiAssistantAvailable', () => ({
  useAiAssistantAvailable: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  listAiServerConversations,
  createAiServerConversation,
} from '../conversation-store'
import { useAiAssistantAvailable } from '../useAiAssistantAvailable'

const listMock = listAiServerConversations as jest.MockedFunction<typeof listAiServerConversations>
const createMock = createAiServerConversation as jest.MockedFunction<typeof createAiServerConversation>
const aiAvailableMock = useAiAssistantAvailable as jest.MockedFunction<typeof useAiAssistantAvailable>
const loggerError = createLogger('ui').error as jest.Mock
const loggerWarn = createLogger('ui').warn as jest.Mock

const KEY_PREFIX = 'om-ai-chat-sessions-v1'

function scopedKey(tenantId: string | null, organizationId: string | null): string {
  return `${KEY_PREFIX}:${tenantId ?? 'no-tenant'}:${organizationId ?? 'no-org'}`
}

function CreateSessionButton({ agentId }: { agentId: string }) {
  const sessions = useAiChatSessions()
  return (
    <button type="button" onClick={() => sessions.createSession(agentId)}>
      Create session
    </button>
  )
}

function SessionCount({ agentId }: { agentId: string }) {
  const sessions = useAiChatSessions()
  const open = sessions.getOpenSessions(agentId)
  return <span data-testid="session-count">{open.length}</span>
}

function Harness({ agentId }: { agentId: string }) {
  return (
    <AiChatSessionsProvider>
      <CreateSessionButton agentId={agentId} />
      <SessionCount agentId={agentId} />
    </AiChatSessionsProvider>
  )
}

describe('<AiChatSessionsProvider> — tenant/org scope isolation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    listMock.mockReset()
    listMock.mockResolvedValue(null)
    createMock.mockReset()
    createMock.mockResolvedValue(null)
    aiAvailableMock.mockReset()
    aiAvailableMock.mockReturnValue(true)
    loggerError.mockClear()
    loggerWarn.mockClear()
    // Reset scope to a known starting point. The module-level state in
    // organizationEvents persists across tests in the same file.
    act(() => {
      emitOrganizationScopeChanged({ tenantId: 'T1', organizationId: 'O1' })
    })
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('does not read or write the legacy unscoped key', async () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        sessions: [
          {
            id: 'legacy-session',
            agentId: 'assistant',
            conversationId: 'legacy-conv',
            createdAt: 1,
            lastUsedAt: 1,
            status: 'open',
          },
        ],
        activeByAgent: { assistant: 'legacy-session' },
      }),
    )

    renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('0')
    })

    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).not.toBeNull()
  })

  it('writes new sessions to the tenant/org scoped key', async () => {
    renderWithProviders(<Harness agentId="assistant" />)

    act(() => {
      screen.getByRole('button', { name: 'Create session' }).click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('1')
    })

    const scoped = window.localStorage.getItem(scopedKey('T1', 'O1'))
    expect(scoped).not.toBeNull()
    const parsed = JSON.parse(scoped!) as { v: number; data: { sessions: Array<{ agentId: string }> } }
    expect(parsed.v).toBe(1)
    expect(parsed.data.sessions).toHaveLength(1)
    expect(parsed.data.sessions[0].agentId).toBe('assistant')

    expect(window.localStorage.getItem(scopedKey('T2', 'O2'))).toBeNull()
  })

  it('rehydrates from the new scope on scope change (no flash of previous-scope data)', async () => {
    // Seed BOTH scopes' buckets with distinct session counts so we can
    // observe the swap.
    window.localStorage.setItem(
      scopedKey('T1', 'O1'),
      JSON.stringify({
        sessions: [
          {
            id: 's1',
            agentId: 'assistant',
            conversationId: 'c1',
            createdAt: 1,
            lastUsedAt: 1,
            status: 'open',
          },
          {
            id: 's2',
            agentId: 'assistant',
            conversationId: 'c2',
            createdAt: 2,
            lastUsedAt: 2,
            status: 'open',
          },
        ],
        activeByAgent: { assistant: 's1' },
      }),
    )
    window.localStorage.setItem(
      scopedKey('T2', 'O2'),
      JSON.stringify({
        sessions: [
          {
            id: 's3',
            agentId: 'assistant',
            conversationId: 'c3',
            createdAt: 3,
            lastUsedAt: 3,
            status: 'open',
          },
        ],
        activeByAgent: { assistant: 's3' },
      }),
    )

    renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('2')
    })

    act(() => {
      emitOrganizationScopeChanged({ tenantId: 'T2', organizationId: 'O2' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('1')
    })

    // T1/O1 bucket must retain its 2 sessions after the swap. The legacy bare
    // value seeded above is migrated forward to the versioned `{ v, data }`
    // envelope on mount, so read the sessions from `data`.
    const t1Raw = window.localStorage.getItem(scopedKey('T1', 'O1'))
    expect(t1Raw).not.toBeNull()
    const t1Parsed = JSON.parse(t1Raw!) as { v: number; data: { sessions: unknown[] } }
    expect(t1Parsed.v).toBe(1)
    expect(t1Parsed.data.sessions).toHaveLength(2)
  })

  it('refires the server conversation list on scope change', async () => {
    renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })

    act(() => {
      emitOrganizationScopeChanged({ tenantId: 'T2', organizationId: 'O2' })
    })

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2)
    })
  })

  it('warns when the server conversation list is unavailable', async () => {
    listMock.mockReset()
    listMock.mockResolvedValue(null)

    renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(loggerWarn).toHaveBeenCalledWith(
        'Could not load server conversations; keeping the locally persisted sessions',
      )
    })
  })

  it('logs and keeps the locally persisted sessions when the server list rejects', async () => {
    const failure = new Error('[internal] conversations endpoint unreachable')
    listMock.mockReset()
    listMock.mockRejectedValue(failure)
    window.localStorage.setItem(
      scopedKey('T1', 'O1'),
      JSON.stringify({
        sessions: [
          {
            id: 'local-session',
            agentId: 'assistant',
            conversationId: 'local-conv',
            createdAt: 1,
            lastUsedAt: 1,
            status: 'open',
          },
        ],
        activeByAgent: { assistant: 'local-session' },
      }),
    )

    renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(loggerError).toHaveBeenCalledWith('Failed to load server conversations', {
        err: failure,
      })
    })

    expect(screen.getByTestId('session-count').textContent).toBe('1')
  })

  it('falls back to the no-tenant/no-org bucket when scope is unresolved', async () => {
    act(() => {
      emitOrganizationScopeChanged({ tenantId: null, organizationId: null })
    })

    renderWithProviders(<Harness agentId="assistant" />)

    act(() => {
      screen.getByRole('button', { name: 'Create session' }).click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('1')
    })

    expect(window.localStorage.getItem(scopedKey(null, null))).not.toBeNull()
  })
})

describe('<AiChatSessionsProvider> — ai_assistant availability gate', () => {
  beforeEach(() => {
    window.localStorage.clear()
    listMock.mockReset()
    listMock.mockResolvedValue([])
    createMock.mockReset()
    createMock.mockResolvedValue(null)
    aiAvailableMock.mockReset()
    loggerError.mockClear()
    loggerWarn.mockClear()
    act(() => {
      emitOrganizationScopeChanged({ tenantId: 'T1', organizationId: 'O1' })
    })
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('skips the server conversation sync when the AI assistant is unavailable', async () => {
    aiAvailableMock.mockReturnValue(false)

    renderWithProviders(<Harness agentId="assistant" />)

    // Children still render — the provider owns context every backend page needs.
    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('0')
    })

    expect(listMock).not.toHaveBeenCalled()
    expect(loggerWarn).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('syncs once when the AI assistant is available', async () => {
    aiAvailableMock.mockReturnValue(true)

    renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })
    expect(listMock).toHaveBeenCalledWith({ limit: 100 })
  })

  // The gate is fail-closed while the backend chrome payload is still null,
  // which is the state at mount on every install. So on an enabled install the
  // sync only ever happens on the re-run triggered by `aiAvailable` flipping
  // true — this pins that dependency.
  it('syncs once the availability gate opens after mount', async () => {
    aiAvailableMock.mockReturnValue(false)

    const { rerender } = renderWithProviders(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('0')
    })
    expect(listMock).not.toHaveBeenCalled()

    aiAvailableMock.mockReturnValue(true)
    rerender(<Harness agentId="assistant" />)

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })
    expect(listMock).toHaveBeenCalledWith({ limit: 100 })
  })
})
