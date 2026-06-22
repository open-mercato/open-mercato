import { z } from 'zod'
import { aiTools, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import * as openCodeRunRegistry from '../lib/runtime/openCodeRunRegistry'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

// The submit_outcome MCP tool resolves the active agent's compiled OUTCOME
// schema from the per-run correlation store keyed by the run session token
// (ctx.sessionId) — never trusted from the model — validates the outcome, and
// signals completion so the waiting runner resolves. This is propose-only's
// terminal signal; it must accept valid outcomes, reject invalid ones as typed
// data (not a throw), and fail closed on a missing/stale correlation.
describe('agent_orchestrator.submit_outcome', () => {
  const tool = aiTools.find((t) => t.name === SUBMIT_OUTCOME_TOOL_ID) as AiToolDefinition
  const resultSchema = z.object({
    kind: z.literal('actionable'),
    proposal: z.object({ stage: z.string().min(1), confidence: z.number() }),
  })

  function makeCtx(sessionId?: string) {
    return { sessionId } as unknown as Parameters<NonNullable<typeof tool.handler>>[1]
  }

  it('is registered with propose-only metadata and the run feature', () => {
    expect(tool).toBeDefined()
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['agent_orchestrator.agents.run'])
  })

  it('accepts a valid outcome, stores it, and completes the run', async () => {
    const key = 'sess_valid_1'
    const handle = openCodeRunRegistry.register(key, { agentId: 'demo.agent', resultSchema })
    try {
      const outcome = { kind: 'actionable', proposal: { stage: 'won', confidence: 0.9 } }
      const result = (await tool.handler!({ outcome }, makeCtx(key))) as { ok: boolean }
      expect(result).toEqual({ ok: true })
      // The waiting runner resolves with the validated outcome.
      await expect(handle.outcomePromise).resolves.toEqual(outcome)
      expect(openCodeRunRegistry.get(key)?.outcome).toEqual(outcome)
    } finally {
      openCodeRunRegistry.dispose(key)
    }
  })

  it('rejects an invalid outcome as typed data (no throw) so the agent can retry', async () => {
    const key = 'sess_invalid_1'
    openCodeRunRegistry.register(key, { agentId: 'demo.agent', resultSchema })
    try {
      const result = (await tool.handler!(
        { outcome: { kind: 'actionable', proposal: { stage: '', confidence: 'nope' } } },
        makeCtx(key),
      )) as { ok: boolean; code?: string; errors?: unknown[] }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('outcome_invalid')
      expect(Array.isArray(result.errors)).toBe(true)
      expect((result.errors as unknown[]).length).toBeGreaterThan(0)
      // Run stays open (not completed) so the agent can resubmit.
      expect(openCodeRunRegistry.get(key)?.outcome).toBeUndefined()
    } finally {
      openCodeRunRegistry.dispose(key)
    }
  })

  it('fails closed for an unknown/stale correlation key', async () => {
    const result = (await tool.handler!(
      { outcome: { kind: 'actionable', proposal: { stage: 'won', confidence: 1 } } },
      makeCtx('sess_does_not_exist'),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })

  it('fails closed when the context carries no session', async () => {
    const result = (await tool.handler!(
      { outcome: { kind: 'actionable', proposal: { stage: 'won', confidence: 1 } } },
      makeCtx(undefined),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })
})
