import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'

// The shared run-session store is the cross-process correlation seam (runner vs.
// the separate mcp:serve-http process). The DB impl mirrors these exact semantics.
describe('InMemoryAgentRunSessionStore', () => {
  const base = { tenantId: 't', organizationId: 'o' }

  it('resolves the active agent for an open run and null for an unknown token', async () => {
    const store = new InMemoryAgentRunSessionStore()
    await store.open({ sessionToken: 'sess_a', agentId: 'demo.agent', ...base })
    expect(await store.resolveActiveAgentId('sess_a')).toBe('demo.agent')
    expect(await store.resolveActiveAgentId('sess_unknown')).toBeNull()
  })

  it('completeOutcome is single-shot: completed → already_completed; missing → not_found', async () => {
    const store = new InMemoryAgentRunSessionStore()
    await store.open({ sessionToken: 'sess_b', agentId: 'demo.agent', ...base })
    expect(await store.completeOutcome('sess_b', { x: 1 })).toBe('completed')
    expect(await store.completeOutcome('sess_b', { x: 2 })).toBe('already_completed')
    expect(await store.completeOutcome('sess_missing', { x: 1 })).toBe('not_found')
  })

  it('readOutcome reports done only after completion, and never overwrites the captured outcome', async () => {
    const store = new InMemoryAgentRunSessionStore()
    await store.open({ sessionToken: 'sess_c', agentId: 'demo.agent', ...base })
    expect(await store.readOutcome('sess_c')).toEqual({ done: false })
    await store.completeOutcome('sess_c', { stage: 'won' })
    expect(await store.readOutcome('sess_c')).toEqual({ done: true, outcome: { stage: 'won' } })
    // already_completed second submit does not overwrite.
    await store.completeOutcome('sess_c', { stage: 'lost' })
    expect(await store.readOutcome('sess_c')).toEqual({ done: true, outcome: { stage: 'won' } })
  })

  it('dispose removes the run so resolve/read fail closed', async () => {
    const store = new InMemoryAgentRunSessionStore()
    await store.open({ sessionToken: 'sess_d', agentId: 'demo.agent', ...base })
    await store.dispose('sess_d')
    expect(await store.resolveActiveAgentId('sess_d')).toBeNull()
    expect(await store.readOutcome('sess_d')).toEqual({ done: false })
  })
})
