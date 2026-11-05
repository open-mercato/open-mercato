/** @jest-environment jsdom */
import { readPersisted, writePersisted } from '../AiChatSessions'

const KEY = 'om-ai-chat-sessions-v1:t1:o1'
const session = {
  id: 's1',
  agentId: 'a1',
  conversationId: 'c1',
  createdAt: 1,
  lastUsedAt: 2,
  status: 'open' as const,
}

describe('AiChatSessions persisted cache (versioned envelope)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes a versioned envelope and reads it back', () => {
    const state = { sessions: [session], activeByAgent: { a1: 's1' } }
    writePersisted(KEY, state)
    const stored = JSON.parse(localStorage.getItem(KEY)!)
    expect(stored.v).toBe(1)
    expect(stored.data).toEqual(state)
    expect(readPersisted(KEY)).toEqual(state)
  })

  it('migrates a legacy bare (pre-envelope) cache on read', () => {
    const legacy = { sessions: [session], activeByAgent: { a1: 's1' } }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    expect(readPersisted(KEY)).toEqual(legacy)
  })

  it('discards a version-mismatched envelope', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 99, data: { sessions: [session], activeByAgent: { a1: 's1' } } }))
    expect(readPersisted(KEY)).toEqual({ sessions: [], activeByAgent: {} })
  })

  it('returns empty state for missing data', () => {
    expect(readPersisted(KEY)).toEqual({ sessions: [], activeByAgent: {} })
  })
})
