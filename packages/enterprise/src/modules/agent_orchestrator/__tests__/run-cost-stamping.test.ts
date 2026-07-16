/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentRun } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

import { completeAgentRunCommand, failAgentRunCommand } from '../commands/runs'

const RUN_ID = '55555555-5555-4555-8555-555555555555'

/** Minimal in-memory EntityManager fake (see run-completed-at.test.ts). */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }

  const em = {
    fork() {
      return em
    },
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
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return (
        storeFor(entity).find((row) =>
          Object.entries(where).every(([key, value]) => (row[key] ?? null) === value),
        ) ?? null
      )
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function makeCtx(em: EntityManager): CommandRuntimeContext {
  const container = {
    resolve(name: string) {
      if (name === 'em') return em
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  }
  return { container } as unknown as CommandRuntimeContext
}

function seedRunningRun(
  storeFor: (entity: unknown) => Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  const row = {
    id: RUN_ID,
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    agentId: 'deals.health_check',
    status: 'running',
    completedAt: null,
    confidence: null,
    inputTokens: null,
    outputTokens: null,
    costMinor: null,
    currency: null,
    ...overrides,
  }
  storeFor(AgentRun).push(row)
  return row
}

describe('runs.complete / runs.fail — additive confidence + usage/cost stamps', () => {
  beforeEach(() => jest.clearAllMocks())

  it('runs.complete stamps confidence, tokens, cost, and currency when supplied', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor)
    await completeAgentRunCommand.execute(
      {
        runId: RUN_ID,
        status: 'ok',
        output: { kind: 'actionable', proposal: {} },
        resultKind: 'actionable',
        confidence: 0.83,
        inputTokens: 1200,
        outputTokens: 340,
        costMinor: 42,
        currency: 'USD',
      },
      makeCtx(em),
    )
    expect(row.confidence).toBe(0.83)
    expect(row.inputTokens).toBe(1200)
    expect(row.outputTokens).toBe(340)
    expect(row.costMinor).toBe(42)
    expect(row.currency).toBe('USD')
  })

  it('BC: absent fields leave columns byte-for-byte untouched', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor, {
      confidence: 0.5,
      inputTokens: 7,
      outputTokens: 8,
      costMinor: 9,
      currency: 'EUR',
    })
    await completeAgentRunCommand.execute(
      { runId: RUN_ID, status: 'ok', output: { kind: 'informative', data: {} }, resultKind: 'informative' },
      makeCtx(em),
    )
    expect(row.confidence).toBe(0.5)
    expect(row.inputTokens).toBe(7)
    expect(row.outputTokens).toBe(8)
    expect(row.costMinor).toBe(9)
    expect(row.currency).toBe('EUR')
  })

  it('explicit nulls clear the columns (distinct from absent)', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor, { confidence: 0.5 })
    await completeAgentRunCommand.execute(
      {
        runId: RUN_ID,
        status: 'ok',
        output: { kind: 'informative', data: {} },
        resultKind: 'informative',
        confidence: null,
      },
      makeCtx(em),
    )
    expect(row.confidence).toBeNull()
  })

  it('runs.fail stamps tokens/cost — failed runs still consumed tokens', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor)
    await failAgentRunCommand.execute(
      { runId: RUN_ID, errorMessage: 'boom', inputTokens: 500, outputTokens: 100, costMinor: 3, currency: 'USD' },
      makeCtx(em),
    )
    expect(row.status).toBe('error')
    expect(row.inputTokens).toBe(500)
    expect(row.outputTokens).toBe(100)
    expect(row.costMinor).toBe(3)
    expect(row.currency).toBe('USD')
  })

  it('runs.fail without stamps leaves columns untouched (BC)', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor, { inputTokens: 11, costMinor: 22 })
    await failAgentRunCommand.execute({ runId: RUN_ID, errorMessage: 'boom' }, makeCtx(em))
    expect(row.inputTokens).toBe(11)
    expect(row.costMinor).toBe(22)
  })
})
