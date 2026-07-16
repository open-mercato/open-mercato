import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProcess, AgentProposal, AgentRun } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

import {
  deriveProcessStatus,
  recomputeAgentProcess,
  recomputeFromEvent,
} from '../lib/processes/agentProcessProjection'
import { emitAgentOrchestratorEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const PROCESS = '33333333-3333-4333-8333-333333333333'
const RUN_A = '44444444-4444-4444-8444-444444444444'
const RUN_B = '55555555-5555-4555-8555-555555555555'

const SCOPE = { tenantId: TENANT, organizationId: ORG }

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)
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
    async find(entity: unknown, where: Record<string, unknown>, _opts?: unknown) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function seedRun(
  storeFor: ReturnType<typeof createFakeEm>['storeFor'],
  overrides: Record<string, unknown> = {},
) {
  storeFor(AgentRun).push({
    id: RUN_A,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'claims.intake',
    processId: PROCESS,
    stepId: 'intake',
    costMinor: 40,
    currency: 'PLN',
    createdAt: new Date('2026-07-10T09:00:00Z'),
    updatedAt: new Date('2026-07-10T09:00:05Z'),
    ...overrides,
  })
}

function seedProposal(
  storeFor: ReturnType<typeof createFakeEm>['storeFor'],
  overrides: Record<string, unknown> = {},
) {
  storeFor(AgentProposal).push({
    id: `prop-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'claims.intake',
    runId: RUN_A,
    processId: PROCESS,
    stepId: 'intake',
    disposition: 'pending',
    createdAt: new Date('2026-07-10T09:00:10Z'),
    updatedAt: new Date('2026-07-10T09:00:10Z'),
    ...overrides,
  })
}

describe('deriveProcessStatus — precedence table (first match wins)', () => {
  const base = {
    terminal: null,
    subjectFraud: null,
    subjectFacets: null,
    pendingProposalCount: 0,
    dispositions: [] as string[],
    latestDisposition: null as string | null,
  }

  it('terminal failed / cancelled win over everything', () => {
    expect(deriveProcessStatus({ ...base, terminal: 'failed', pendingProposalCount: 2 })).toBe('failed')
    expect(deriveProcessStatus({ ...base, terminal: 'cancelled', subjectFraud: true })).toBe('cancelled')
  })

  it('fraud facet + pending → fraud_hold (over waiting_on_you)', () => {
    expect(
      deriveProcessStatus({ ...base, subjectFraud: true, pendingProposalCount: 1 }),
    ).toBe('fraud_hold')
  })

  it('facet-driven docs_requested / question_open when pending', () => {
    expect(
      deriveProcessStatus({
        ...base,
        pendingProposalCount: 1,
        subjectFacets: { docsRequested: true },
      }),
    ).toBe('docs_requested')
    expect(
      deriveProcessStatus({
        ...base,
        pendingProposalCount: 1,
        subjectFacets: { questionOpen: true },
      }),
    ).toBe('question_open')
  })

  it('pending actionable proposal → waiting_on_you', () => {
    expect(deriveProcessStatus({ ...base, pendingProposalCount: 1 })).toBe('waiting_on_you')
  })

  it('terminal completed: all auto → auto_completed; ≥1 human verdict → completed', () => {
    expect(
      deriveProcessStatus({
        ...base,
        terminal: 'completed',
        dispositions: ['auto_approved', 'auto_approved'],
      }),
    ).toBe('auto_completed')
    expect(
      deriveProcessStatus({
        ...base,
        terminal: 'completed',
        dispositions: ['auto_approved', 'approved'],
      }),
    ).toBe('completed')
  })

  it('latest auto_approved while instance advances → auto_completing, else running', () => {
    expect(
      deriveProcessStatus({
        ...base,
        dispositions: ['auto_approved'],
        latestDisposition: 'auto_approved',
      }),
    ).toBe('auto_completing')
    expect(deriveProcessStatus(base)).toBe('running')
  })
})

describe('recomputeAgentProcess — idempotent upsert', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates exactly one row with subject, agents, cost, openedAt; recompute updates it', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)
    seedProposal(storeFor)

    const first = await recomputeAgentProcess(em, SCOPE, PROCESS, {
      subject: {
        subjectType: 'Motor',
        subjectLabel: 'CLM-2026-04417',
        subjectTitle: 'Motor collision — payout adjudication',
        valueMinor: 1840000,
        fraud: false,
      },
    })
    expect(first).not.toBeNull()
    const rows = storeFor(AgentProcess)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      processId: PROCESS,
      tenantId: TENANT,
      organizationId: ORG,
      subjectType: 'Motor',
      subjectLabel: 'CLM-2026-04417',
      subjectValueMinor: 1840000,
      status: 'waiting_on_you',
      runCount: 1,
      pendingProposalCount: 1,
      costMinor: 40,
      currency: 'PLN',
      agentIds: ['claims.intake'],
    })
    expect((rows[0].openedAt as Date).toISOString()).toBe('2026-07-10T09:00:00.000Z')
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.process.updated',
      expect.objectContaining({ processId: PROCESS, tenantId: TENANT, organizationId: ORG }),
    )

    // A second run + replayed recompute updates the SAME row (no duplicate) and
    // a subject-less event never nulls the stamped subject.
    seedRun(storeFor, {
      id: RUN_B,
      agentId: 'claims.coverage',
      costMinor: 25,
      stepId: 'coverage',
      createdAt: new Date('2026-07-10T09:05:00Z'),
      updatedAt: new Date('2026-07-10T09:05:05Z'),
    })
    const second = await recomputeAgentProcess(em, SCOPE, PROCESS)
    expect(second?.processRowId).toBe(first?.processRowId)
    expect(storeFor(AgentProcess)).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      runCount: 2,
      costMinor: 65,
      subjectLabel: 'CLM-2026-04417',
      agentIds: ['claims.coverage', 'claims.intake'],
      currentStage: 'coverage',
    })
  })

  it('replaying the same event is a no-op on row count and aggregates', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)
    seedProposal(storeFor)
    await recomputeAgentProcess(em, SCOPE, PROCESS)
    await recomputeAgentProcess(em, SCOPE, PROCESS)
    await recomputeAgentProcess(em, SCOPE, PROCESS)
    const rows = storeFor(AgentProcess)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ runCount: 1, pendingProposalCount: 1 })
  })

  it('terminal latch: a late agent recompute never downgrades a terminal status', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)
    seedProposal(storeFor, { disposition: 'auto_approved' })
    await recomputeAgentProcess(em, SCOPE, PROCESS, { terminal: 'completed' })
    expect(storeFor(AgentProcess)[0].status).toBe('auto_completed')

    await recomputeAgentProcess(em, SCOPE, PROCESS)
    expect(storeFor(AgentProcess)[0].status).toBe('auto_completed')
  })

  it('createIfMissing:false never creates rows (non-agent workflows stay invisible)', async () => {
    const { em, storeFor } = createFakeEm()
    const result = await recomputeAgentProcess(em, SCOPE, PROCESS, {
      createIfMissing: false,
      terminal: 'completed',
    })
    expect(result).toBeNull()
    expect(storeFor(AgentProcess)).toHaveLength(0)
  })

  it('waitingSince tracks the oldest pending proposal and clears when disposed', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)
    const proposal = {
      id: 'prop-1',
      tenantId: TENANT,
      organizationId: ORG,
      agentId: 'claims.intake',
      runId: RUN_A,
      processId: PROCESS,
      stepId: 'intake',
      disposition: 'pending',
      createdAt: new Date('2026-07-10T10:00:00Z'),
      updatedAt: new Date('2026-07-10T10:00:00Z'),
    }
    storeFor(AgentProposal).push(proposal)
    await recomputeAgentProcess(em, SCOPE, PROCESS)
    expect((storeFor(AgentProcess)[0].waitingSince as Date).toISOString()).toBe(
      '2026-07-10T10:00:00.000Z',
    )

    proposal.disposition = 'approved'
    await recomputeAgentProcess(em, SCOPE, PROCESS)
    expect(storeFor(AgentProcess)[0].waitingSince).toBeNull()
  })
})

describe('recomputeFromEvent — payload plumbing', () => {
  beforeEach(() => jest.clearAllMocks())

  it('skips payloads without scope or processId', async () => {
    const { em, storeFor } = createFakeEm()
    expect(await recomputeFromEvent(em, { processId: PROCESS })).toBeNull()
    expect(await recomputeFromEvent(em, { tenantId: TENANT, organizationId: ORG })).toBeNull()
    expect(storeFor(AgentProcess)).toHaveLength(0)
  })

  it('resolves processId from the run row for run-keyed events (org-scoped)', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)
    seedProposal(storeFor)
    const result = await recomputeFromEvent(
      em,
      { id: RUN_A, tenantId: TENANT, organizationId: ORG },
      { resolveProcessIdFromRunId: RUN_A },
    )
    expect(result).not.toBeNull()
    expect(storeFor(AgentProcess)[0]).toMatchObject({ processId: PROCESS })

    // Cross-org run id resolves nothing — no projection write.
    const crossOrg = await recomputeFromEvent(
      em,
      { id: RUN_A, tenantId: TENANT, organizationId: OTHER_ORG },
      { resolveProcessIdFromRunId: RUN_A },
    )
    expect(crossOrg).toBeNull()
    expect(storeFor(AgentProcess)).toHaveLength(1)
  })
})
