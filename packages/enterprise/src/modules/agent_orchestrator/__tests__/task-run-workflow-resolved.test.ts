import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentTaskRun } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

import { resolveWorkflowTaskRun } from '../lib/tasks/resolveWorkflowTaskRun'
import { emitAgentOrchestratorEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const INSTANCE = '33333333-3333-4333-8333-333333333333'

function createFakeEm() {
  const rows: Array<Record<string, unknown>> = []
  const em = {
    fork() {
      return em
    },
    async findOne(_entity: unknown, where: Record<string, unknown>) {
      return rows.find((row) => Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)) ?? null
    },
    async flush() {},
  }
  return { em: em as unknown as EntityManager, rows }
}

function seedRun(rows: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  rows.push({
    id: 'task-run-1',
    tenantId: TENANT,
    organizationId: ORG,
    taskDefinitionId: 'def-1',
    targetType: 'workflow',
    workflowInstanceId: INSTANCE,
    status: 'running',
    failureReason: null,
    ...overrides,
  })
}

const payload = { id: INSTANCE, tenantId: TENANT, organizationId: ORG }

describe('resolveWorkflowTaskRun', () => {
  beforeEach(() => {
    ;(emitAgentOrchestratorEvent as jest.Mock).mockClear()
  })

  it('flips the running ledger row to completed and emits', async () => {
    const { em, rows } = createFakeEm()
    seedRun(rows)

    await resolveWorkflowTaskRun(em, payload, 'completed')

    expect(rows[0].status).toBe('completed')
    expect(rows[0].completedAt).toBeInstanceOf(Date)
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.task_run.completed',
      expect.objectContaining({ id: 'task-run-1' }),
      { persistent: true },
    )
  })

  it('flips to failed with a reason', async () => {
    const { em, rows } = createFakeEm()
    seedRun(rows)

    await resolveWorkflowTaskRun(em, payload, 'failed', 'Workflow instance cancelled')

    expect(rows[0].status).toBe('failed')
    expect(rows[0].failureReason).toBe('Workflow instance cancelled')
  })

  it('is idempotent on redelivery (terminal rows untouched)', async () => {
    const { em, rows } = createFakeEm()
    seedRun(rows, { status: 'completed' })

    await resolveWorkflowTaskRun(em, payload, 'failed')

    expect(rows[0].status).toBe('completed')
    expect(emitAgentOrchestratorEvent).not.toHaveBeenCalled()
  })

  it('never resolves without emitter-attached scope or across orgs', async () => {
    const { em, rows } = createFakeEm()
    seedRun(rows)

    await resolveWorkflowTaskRun(em, { id: INSTANCE }, 'completed')
    expect(rows[0].status).toBe('running')

    await resolveWorkflowTaskRun(
      em,
      { id: INSTANCE, tenantId: TENANT, organizationId: '99999999-9999-4999-8999-999999999999' },
      'completed',
    )
    expect(rows[0].status).toBe('running')
  })
})
