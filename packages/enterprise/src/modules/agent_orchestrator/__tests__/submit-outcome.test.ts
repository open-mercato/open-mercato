import { z } from 'zod'
import { aiTools, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

// submit_outcome resolves the active agent from the SHARED run-session store
// (ctx.sessionId — never trusted from the model), reads that agent's compiled
// OUTCOME schema from the registry, validates the outcome (parsing a JSON-string
// outcome first), and writes it to the store for the polling runner to read. It
// must accept valid outcomes, reject invalid ones as typed data (not a throw),
// and fail closed on a missing/stale/already-completed run.
describe('agent_orchestrator.submit_outcome', () => {
  const tool = aiTools.find((t) => t.name === SUBMIT_OUTCOME_TOOL_ID) as AiToolDefinition

  const AGENT_ID = 'demo.submit_outcome_test'
  const resultSchema = z.object({
    kind: z.literal('actionable'),
    proposal: z.object({ stage: z.string().min(1), confidence: z.number() }),
  })

  beforeAll(() => {
    // Registering the agent makes ensureAgentsLoaded() a no-op (registry non-empty)
    // and lets the handler read the schema via getAgentEntry.
    if (!getAgentEntry(AGENT_ID)) {
      const entry: AgentRegistryEntry = {
        id: AGENT_ID,
        moduleId: 'agent_examples',
        resultKind: 'actionable',
        schema: resultSchema,
        tools: [],
        skills: [],
        subAgents: [],
        label: 'Submit test',
        description: 'test',
        instructions: 'x',
        runtime: 'opencode',
      }
      registerFileAgent(entry)
    }
  })

  function makeCtx(store: InMemoryAgentRunSessionStore, sessionId?: string) {
    return {
      sessionId,
      container: {
        resolve: (name: string) => {
          if (name === 'agentRunSessionStore') return store
          throw new Error(`unexpected resolve("${name}")`)
        },
      },
    } as unknown as Parameters<NonNullable<typeof tool.handler>>[1]
  }

  async function openRun(store: InMemoryAgentRunSessionStore, key: string) {
    await store.open({ sessionToken: key, agentId: AGENT_ID, tenantId: 't', organizationId: 'o' })
  }

  it('is registered with propose-only metadata and the run feature', () => {
    expect(tool).toBeDefined()
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['agent_orchestrator.agents.run'])
  })

  it('accepts a valid outcome, writes it to the store, and completes the run', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_valid_1'
    await openRun(store, key)
    const outcome = { kind: 'actionable', proposal: { stage: 'won', confidence: 0.9 } }
    const result = (await tool.handler!({ outcome }, makeCtx(store, key))) as { ok: boolean }
    expect(result).toEqual({ ok: true })
    expect(await store.readOutcome(key)).toEqual({ done: true, outcome })
  })

  it('accepts a JSON-STRING outcome (parses before validating)', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_jsonstr'
    await openRun(store, key)
    const outcome = { kind: 'actionable', proposal: { stage: 'won', confidence: 0.5 } }
    const result = (await tool.handler!({ outcome: JSON.stringify(outcome) }, makeCtx(store, key))) as { ok: boolean }
    expect(result).toEqual({ ok: true })
    expect(await store.readOutcome(key)).toEqual({ done: true, outcome })
  })

  it('rejects an invalid outcome as typed data (no throw) so the agent can retry', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_invalid_1'
    await openRun(store, key)
    const result = (await tool.handler!(
      { outcome: { kind: 'actionable', proposal: { stage: '', confidence: 'nope' } } },
      makeCtx(store, key),
    )) as { ok: boolean; code?: string; errors?: unknown[] }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('outcome_invalid')
    expect((result.errors as unknown[]).length).toBeGreaterThan(0)
    expect(await store.readOutcome(key)).toEqual({ done: false }) // run stays open
  })

  it('rejects an unparseable string outcome', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_badstr'
    await openRun(store, key)
    const result = (await tool.handler!({ outcome: 'not json {' }, makeCtx(store, key))) as {
      ok: boolean
      code?: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('outcome_invalid')
  })

  it('is single-shot: a second valid submit returns no_active_run (already completed)', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_twice'
    await openRun(store, key)
    const outcome = { kind: 'actionable', proposal: { stage: 'won', confidence: 1 } }
    expect(await tool.handler!({ outcome }, makeCtx(store, key))).toEqual({ ok: true })
    const second = (await tool.handler!({ outcome }, makeCtx(store, key))) as { ok: boolean; code?: string }
    expect(second.ok).toBe(false)
    expect(second.code).toBe('no_active_run')
  })

  it('fails closed for an unknown/stale correlation key', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const result = (await tool.handler!(
      { outcome: { kind: 'actionable', proposal: { stage: 'won', confidence: 1 } } },
      makeCtx(store, 'sess_does_not_exist'),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })

  it('fails closed when the context carries no session', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const result = (await tool.handler!(
      { outcome: { kind: 'actionable', proposal: { stage: 'won', confidence: 1 } } },
      makeCtx(store, undefined),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })
})
