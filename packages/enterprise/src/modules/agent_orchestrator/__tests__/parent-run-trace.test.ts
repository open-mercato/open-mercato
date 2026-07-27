import { z } from 'zod'
import { aiTools } from '../ai-tools'
import { DELEGATE_TOOL_ID, registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { withRunContext } from '../lib/runtime/runContext'
import { createRun } from '../lib/runtime/persistence'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const delegateTool = aiTools.find((t) => t.name === DELEGATE_TOOL_ID) as AiToolDefinition

const SUB_AGENT_ID = 'parent_trace.worker'

function registerInformativeSubAgent(): AgentRegistryEntry {
  const existing = getAgentEntry(SUB_AGENT_ID)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id: SUB_AGENT_ID,
    moduleId: 'agent_orchestrator',
    resultKind: 'informative',
    schema: z.object({ kind: z.literal('informative'), data: z.unknown() }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Worker',
    description: 'Informative worker.',
    instructions: 'inform',
    runtime: 'in-process',
  }
  registerFileAgent(entry)
  return entry
}

describe('parent_run_id nested-run trace (Phase 4)', () => {
  it('persists parentRunId through createRun → runs.create command', async () => {
    let captured: Record<string, unknown> | undefined
    const commandBus = {
      async execute<I, O>(id: string, opts: { input: I }): Promise<{ result: O }> {
        if (id === 'agent_orchestrator.runs.create') {
          captured = opts.input as Record<string, unknown>
          return { result: { runId: 'nested-run-1' } as unknown as O }
        }
        return { result: {} as unknown as O }
      },
    }
    const runId = await createRun(commandBus as never, {} as never, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: SUB_AGENT_ID,
      input: { x: 1 },
      parentRunId: 'parent-run-99',
    })
    expect(runId).toBe('nested-run-1')
    expect(captured?.parentRunId).toBe('parent-run-99')
  })

  it('the in-process delegate tool stamps the current run id as the nested run parentRunId', async () => {
    registerInformativeSubAgent()
    let runCtxSeen: { parentRunId?: string } | undefined
    const agentRuntime = {
      async run(_agentId: string, _input: unknown, ctx: { parentRunId?: string }) {
        runCtxSeen = ctx
        return { kind: 'informative' as const, data: { ok: true } }
      },
    }
    const container = {
      resolve(name: string) {
        if (name === 'agentRuntime') return agentRuntime
        throw new Error(`unexpected resolve("${name}")`)
      },
    }
    const toolCtx = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      container,
    } as unknown as Parameters<NonNullable<typeof delegateTool.handler>>[1]

    // Inside a run context, the delegate tool must forward the parent run id.
    const result = await withRunContext('parent-run-77', () =>
      delegateTool.handler!({ agentId: SUB_AGENT_ID, input: { y: 2 } }, toolCtx),
    )
    expect((result as { ok: boolean }).ok).toBe(true)
    expect(runCtxSeen?.parentRunId).toBe('parent-run-77')
  })

  it('outside a run context the delegated run carries no parentRunId (top-level)', async () => {
    registerInformativeSubAgent()
    let runCtxSeen: { parentRunId?: string } | undefined
    const agentRuntime = {
      async run(_agentId: string, _input: unknown, ctx: { parentRunId?: string }) {
        runCtxSeen = ctx
        return { kind: 'informative' as const, data: {} }
      },
    }
    const container = {
      resolve(name: string) {
        if (name === 'agentRuntime') return agentRuntime
        throw new Error(`unexpected resolve("${name}")`)
      },
    }
    const toolCtx = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      container,
    } as unknown as Parameters<NonNullable<typeof delegateTool.handler>>[1]

    await delegateTool.handler!({ agentId: SUB_AGENT_ID, input: {} }, toolCtx)
    expect(runCtxSeen?.parentRunId).toBeUndefined()
  })
})
