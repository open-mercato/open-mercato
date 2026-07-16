import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { hasRequiredFeatures } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/auth'
import { ingestTrace } from '../lib/trace/traceIngestionService'
import { AgentToolCall } from '../data/entities'
import { runSandboxedScript } from '../lib/runtime/sandboxedScript'
import { webSearchTool, webFetchTool, WEB_SEARCH_TOOL_ID, WEB_FETCH_TOOL_ID } from '../lib/webSearch/webSearchTools'

/**
 * Phase 4 integration coverage for web egress (spec 2026-07-11-agent-web-search-tool).
 * Follows the module's established pattern: DB/logic integration is proven with jest
 * at the real seams (real `hasRequiredFeatures`, real `ingestTrace` + real entities
 * over an in-memory em, the real `isolated-vm` sandbox, the real committed
 * `opencode.jsonc`) — full HTTP+OpenCode wire flow is deferred to the Playwright suite
 * per the TC-AGENT-TRACE-002 precedent (no per-tool MCP-wire endpoint exists to drive).
 */

const WEB_FEATURE = 'agent_orchestrator.web_search'

describe('web egress — ACL gate (the gate the MCP server enforces per call)', () => {
  it('DENIES a caller that lacks the web_search feature', () => {
    // A caller granted only agents.run (can run agents) is NOT authorized for web egress.
    expect(hasRequiredFeatures([WEB_FEATURE], ['agent_orchestrator.agents.run'], false)).toBe(false)
    expect(hasRequiredFeatures([WEB_FEATURE], [], false)).toBe(false)
  })

  it('GRANTS a caller holding the feature, the wildcard, or superadmin', () => {
    expect(hasRequiredFeatures([WEB_FEATURE], [WEB_FEATURE], false)).toBe(true)
    expect(hasRequiredFeatures([WEB_FEATURE], ['agent_orchestrator.*'], false)).toBe(true)
    expect(hasRequiredFeatures([WEB_FEATURE], [], true)).toBe(true)
  })

  it('binds both tools to that feature and to propose-only (isMutation:false)', () => {
    for (const tool of [webSearchTool, webFetchTool]) {
      expect(tool.requiredFeatures).toEqual([WEB_FEATURE])
      expect(tool.isMutation).toBe(false)
    }
    expect(webSearchTool.name).toBe(WEB_SEARCH_TOOL_ID)
    expect(webFetchTool.name).toBe(WEB_FETCH_TOOL_ID)
  })
})

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value)
  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

describe('web egress — trace capture', () => {
  it('records a web_search / web_fetch tool call as an AgentToolCall row', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(
      em,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      {
        runtime: 'in-process',
        externalRunId: 'run-web-1',
        agentId: 'deals.web_researcher',
        status: 'ok',
        output: { kind: 'informative', data: { ok: true } },
        spans: [
          {
            externalSpanId: 'span-search',
            sequence: 0,
            name: WEB_SEARCH_TOOL_ID,
            kind: 'tool',
            startedAt: '2026-07-15T00:00:00.000Z',
            toolCalls: [{ toolName: WEB_SEARCH_TOOL_ID, status: 'ok' }],
          },
          {
            externalSpanId: 'span-fetch',
            sequence: 1,
            name: WEB_FETCH_TOOL_ID,
            kind: 'tool',
            startedAt: '2026-07-15T00:00:01.000Z',
            toolCalls: [{ toolName: WEB_FETCH_TOOL_ID, status: 'ok' }],
          },
        ],
      },
    )
    const toolCalls = storeFor(AgentToolCall)
    const names = toolCalls.map((row) => row.toolName)
    expect(names).toContain(WEB_SEARCH_TOOL_ID)
    expect(names).toContain(WEB_FETCH_TOOL_ID)
  })
})

describe('web egress — invariants preserved', () => {
  it('keeps OpenCode native web tools disabled in opencode.jsonc', () => {
    const configPath = path.resolve(__dirname, '../../../../../../docker/opencode/opencode.jsonc')
    const text = fs.readFileSync(configPath, 'utf8')
    // Native websearch/webfetch must never be enabled — egress goes through our MCP tools only.
    expect(text).not.toMatch(/"websearch"\s*:\s*true/i)
    expect(text).not.toMatch(/"webfetch"\s*:\s*true/i)
    // Sanity: this is the right file (it wires the single open-mercato MCP server).
    expect(text).toContain('open-mercato')
  })

  it('keeps the isolated-vm sandbox no-net: a script cannot fetch a URL', async () => {
    const outcome = await runSandboxedScript({
      source: 'export async function run() { return await fetch("http://example.com") }',
      args: undefined,
    })
    expect(outcome.ok).toBe(false)
  })
})
