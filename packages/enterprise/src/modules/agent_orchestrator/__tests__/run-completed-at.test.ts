/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentRun } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

import { completeAgentRunCommand, failAgentRunCommand } from '../commands/runs'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '55555555-5555-4555-8555-555555555555'

/** Minimal in-memory EntityManager fake (see run-flag-rerun.test.ts). */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

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
        if (!row.id) row.id = `id-${++idSeq}`
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
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'deals.health_check',
    status: 'running',
    completedAt: null,
    ...overrides,
  }
  storeFor(AgentRun).push(row)
  return row
}

describe('runs.complete / runs.fail — forensic completed_at stamping', () => {
  beforeEach(() => jest.clearAllMocks())

  it('runs.complete stamps completed_at at the terminal transition', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor)
    await completeAgentRunCommand.execute(
      { runId: RUN_ID, status: 'ok', output: { kind: 'informative', data: {} }, resultKind: 'informative' },
      makeCtx(em),
    )
    expect(row.status).toBe('ok')
    expect(row.completedAt).toBeInstanceOf(Date)
  })

  it('runs.fail stamps completed_at at the terminal transition', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRunningRun(storeFor)
    await failAgentRunCommand.execute({ runId: RUN_ID, errorMessage: 'boom' }, makeCtx(em))
    expect(row.status).toBe('error')
    expect(row.completedAt).toBeInstanceOf(Date)
  })

  it('never overwrites a pre-existing completed_at', async () => {
    const { em, storeFor } = createFakeEm()
    const original = new Date('2026-07-01T10:00:00Z')
    const row = seedRunningRun(storeFor, { completedAt: original })
    await completeAgentRunCommand.execute(
      { runId: RUN_ID, status: 'ok', output: { kind: 'informative', data: {} }, resultKind: 'informative' },
      makeCtx(em),
    )
    expect(row.completedAt).toBe(original)
  })
})
