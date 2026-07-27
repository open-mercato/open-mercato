/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentRun } from '../data/entities'
import { withRerunOf, getRerunOfRunId } from '../lib/runtime/rerunContext'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => undefined),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

import { toggleRunFlagCommand } from '../commands/runActions'
import { createAgentRunCommand } from '../commands/runs'
import { POST as rerunPost } from '../api/runs/[id]/rerun/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const USER = '44444444-4444-4444-8444-444444444444'

/** Minimal in-memory EntityManager fake (see eval-case-from-run.test.ts). */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      const cell = row[key] ?? null
      if (value !== null && typeof value === 'object' && '$gte' in (value as Record<string, unknown>)) {
        const bound = (value as { $gte: Date }).$gte
        return cell instanceof Date && bound instanceof Date ? cell.getTime() >= bound.getTime() : false
      }
      return cell === value
    })
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
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
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
  return {
    container,
    request: new Request('http://test/flag', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
}

describe('agent_orchestrator.runs.toggleFlag', () => {
  beforeEach(() => jest.clearAllMocks())

  function seedRun(storeFor: (entity: unknown) => Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
    const row = {
      id: RUN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      agentId: 'deals.health_check',
      status: 'ok',
      deletedAt: null,
      flaggedAt: null,
      flaggedBy: null,
      ...overrides,
    }
    storeFor(AgentRun).push(row)
    return row
  }

  it('flags an unflagged run with the acting user', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRun(storeFor)
    const result = await toggleRunFlagCommand.execute(
      { tenantId: TENANT, organizationId: ORG, agentRunId: RUN_ID, userId: USER },
      makeCtx(em),
    )
    expect(result.flagged).toBe(true)
    expect(result.flaggedAt).toEqual(expect.any(String))
    expect(row.flaggedAt).toBeInstanceOf(Date)
    expect(row.flaggedBy).toBe(USER)
  })

  it('unflags a flagged run and clears both columns', async () => {
    const { em, storeFor } = createFakeEm()
    const row = seedRun(storeFor, { flaggedAt: new Date('2026-07-01T00:00:00Z'), flaggedBy: USER })
    const result = await toggleRunFlagCommand.execute(
      { tenantId: TENANT, organizationId: ORG, agentRunId: RUN_ID, userId: USER },
      makeCtx(em),
    )
    expect(result).toEqual({ flagged: false, flaggedAt: null })
    expect(row.flaggedAt).toBeNull()
    expect(row.flaggedBy).toBeNull()
  })

  it('404s a run in another organization', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor, { organizationId: OTHER_ORG })
    await expect(
      toggleRunFlagCommand.execute(
        { tenantId: TENANT, organizationId: ORG, agentRunId: RUN_ID, userId: USER },
        makeCtx(em),
      ),
    ).rejects.toThrow(CrudHttpError)
  })

  it('never mutates the forensic completed_at (flag then unflag)', async () => {
    const { em, storeFor } = createFakeEm()
    const completedAt = new Date('2026-07-10T03:47:00Z')
    const row = seedRun(storeFor, { completedAt })
    await toggleRunFlagCommand.execute(
      { tenantId: TENANT, organizationId: ORG, agentRunId: RUN_ID, userId: USER },
      makeCtx(em),
    )
    expect(row.completedAt).toBe(completedAt)
    await toggleRunFlagCommand.execute(
      { tenantId: TENANT, organizationId: ORG, agentRunId: RUN_ID, userId: USER },
      makeCtx(em),
    )
    expect(row.completedAt).toBe(completedAt)
  })
})

describe('agent_orchestrator.runs.create — rerun lineage stamp', () => {
  beforeEach(() => jest.clearAllMocks())

  const baseInput = {
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'deals.health_check',
    input: { deal: { id: 'deal-1' } },
  }

  it('stamps rerunOfRunId on a top-level run created inside withRerunOf', async () => {
    const { em, storeFor } = createFakeEm()
    await withRerunOf(RUN_ID, async () => {
      await createAgentRunCommand.execute(baseInput, makeCtx(em))
    })
    expect(storeFor(AgentRun)[0]?.rerunOfRunId).toBe(RUN_ID)
  })

  it('does not stamp nested (parentRunId) runs or runs outside the rerun context', async () => {
    const { em, storeFor } = createFakeEm()
    await withRerunOf(RUN_ID, async () => {
      await createAgentRunCommand.execute(
        { ...baseInput, parentRunId: '66666666-6666-4666-8666-666666666666' },
        makeCtx(em),
      )
    })
    await createAgentRunCommand.execute(baseInput, makeCtx(em))
    expect(storeFor(AgentRun)[0]?.rerunOfRunId).toBeNull()
    expect(storeFor(AgentRun)[1]?.rerunOfRunId).toBeNull()
  })
})

describe('POST /api/agent_orchestrator/runs/:id/rerun', () => {
  beforeEach(() => jest.clearAllMocks())

  const SOURCE_INPUT = { deal: { id: 'deal-1' } }
  const NEW_RUN_ID = '77777777-7777-4777-8777-777777777777'

  function makeRequest() {
    return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/rerun`, { method: 'POST' })
  }
  const params = Promise.resolve({ id: RUN_ID })

  async function setup(sourceRun: Record<string, unknown> | null) {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const { resolveOrganizationScopeForRequest } = await import(
      '@open-mercato/core/modules/directory/utils/organizationScope'
    )
    const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({ selectedId: ORG })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(sourceRun)

    let rerunIdDuringRun: string | undefined
    const run = jest.fn(async () => {
      rerunIdDuringRun = getRerunOfRunId()
      return { kind: 'informative', data: { ok: true } }
    })
    const findOne = jest.fn(async () => ({ id: NEW_RUN_ID }))
    const em = { fork: () => ({ findOne, fork: () => ({ findOne }) }) }
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'agentRuntime') return { run }
        if (token === 'em') return em
        return null
      },
    })
    return { run, findOne, getRerunIdDuringRun: () => rerunIdDuringRun }
  }

  it('re-runs the agent with the decrypted original input inside the rerun context and returns the new run id', async () => {
    const { run, findOne, getRerunIdDuringRun } = await setup({
      id: RUN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      agentId: 'deals.health_check',
      input: SOURCE_INPUT,
    })
    const res = await rerunPost(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ runId: NEW_RUN_ID })
    expect(run).toHaveBeenCalledWith(
      'deals.health_check',
      SOURCE_INPUT,
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG, userId: USER }),
    )
    expect(getRerunIdDuringRun()).toBe(RUN_ID)
    expect(findOne).toHaveBeenCalledWith(
      AgentRun,
      expect.objectContaining({ rerunOfRunId: RUN_ID, tenantId: TENANT, organizationId: ORG }),
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    )
  })

  it('404s an unknown or cross-org run without invoking the runtime', async () => {
    const { run } = await setup(null)
    const res = await rerunPost(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})
