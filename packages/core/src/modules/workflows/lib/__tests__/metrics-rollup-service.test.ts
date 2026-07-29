/**
 * Per-definition KPI rollup (spec §8.5) — the data-access half.
 *
 * Covers the three properties the rollup MUST have and that the pure
 * arithmetic cannot guarantee on its own: it is idempotent, it never leaves the
 * caller's tenant/organization, and it never counts a dry run.
 *
 * The EntityManager is a small in-memory fake rather than a bag of
 * `jest.fn()`s: idempotency is a claim about what the table looks like after
 * two passes, which a call-count assertion cannot express.
 */

import { UserTask, WorkflowDefinitionMetricRollup, WorkflowInstance } from '../../data/entities'
import {
  computeDefinitionMetrics,
  listActiveWorkflowIds,
  resolveWindowBounds,
  writeRollupsForScope,
} from '../metrics/rollup-service'
import { WORKFLOW_ROLLUP_BUCKET_MS } from '../metrics/definition-metrics'

type Row = Record<string, unknown>

const tenantId = 'tenant-1'
const otherTenantId = 'tenant-2'
const organizationId = 'org-1'
const otherOrganizationId = 'org-2'

/**
 * Evaluate one MikroORM-style condition value against a field.
 * Supports the operators this service actually uses.
 */
function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
    const operators = condition as Record<string, unknown>
    for (const [operator, operand] of Object.entries(operators)) {
      const left = value instanceof Date ? value.getTime() : value
      const right = operand instanceof Date ? operand.getTime() : operand
      if (operator === '$in' && !(operand as unknown[]).includes(value)) return false
      if (operator === '$ne' && value === operand) return false
      if (operator === '$gte' && !(left !== null && left !== undefined && (left as number) >= (right as number))) return false
      if (operator === '$lt' && !(left !== null && left !== undefined && (left as number) < (right as number))) return false
      if (!['$in', '$ne', '$gte', '$lt'].includes(operator)) throw new Error(`[internal] unsupported operator ${operator}`)
    }
    return true
  }
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
  if (condition === null) return value === null || value === undefined
  return value === condition
}

function matchesWhere(row: Row, where: Row): boolean {
  for (const [field, condition] of Object.entries(where)) {
    if (field === '$or') {
      const branches = condition as Row[]
      if (!branches.some((branch) => matchesWhere(row, branch))) return false
      continue
    }
    if (!matchesCondition(row[field], condition)) return false
  }
  return true
}

function createFakeEm(tables: { instances?: Row[]; tasks?: Row[]; rollups?: Row[] }) {
  const store = new Map<unknown, Row[]>([
    [WorkflowInstance, tables.instances ?? []],
    [UserTask, tables.tasks ?? []],
    [WorkflowDefinitionMetricRollup, tables.rollups ?? []],
  ])
  const pending: Array<{ entity: unknown; row: Row }> = []
  const seenWhere: Array<{ entity: unknown; where: Row }> = []

  return {
    store,
    seenWhere,
    async find(entity: unknown, where: Row, options?: { limit?: number }) {
      seenWhere.push({ entity, where })
      const rows = (store.get(entity) ?? []).filter((row) => matchesWhere(row, where))
      return options?.limit ? rows.slice(0, options.limit) : rows
    },
    async findOne(entity: unknown, where: Row) {
      seenWhere.push({ entity, where })
      return (store.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null
    },
    async count(entity: unknown, where: Row) {
      seenWhere.push({ entity, where })
      return (store.get(entity) ?? []).filter((row) => matchesWhere(row, where)).length
    },
    create(entity: unknown, row: Row) {
      return { ...row }
    },
    persist(row: Row) {
      const table = store.get(WorkflowDefinitionMetricRollup) ?? []
      if (!table.includes(row)) pending.push({ entity: WorkflowDefinitionMetricRollup, row })
    },
    async flush() {
      for (const { entity, row } of pending) {
        const table = store.get(entity) ?? []
        if (!table.includes(row)) table.push(row)
      }
      pending.length = 0
    },
  }
}

const now = new Date('2026-07-20T12:07:00.000Z')

function instance(overrides: Row): Row {
  return {
    id: `instance-${Math.random().toString(36).slice(2)}`,
    tenantId,
    organizationId,
    workflowId: 'checkout',
    status: 'COMPLETED',
    isDryRun: false,
    deletedAt: null,
    startedAt: new Date('2026-07-20T11:00:00.000Z'),
    completedAt: new Date('2026-07-20T11:00:10.000Z'),
    cancelledAt: null,
    ...overrides,
  }
}

describe('resolveWindowBounds', () => {
  test('every window shares one bucket-aligned end, and each start is its own span back', () => {
    const bounds = resolveWindowBounds(now.getTime())
    const ends = new Set(bounds.map((bound) => bound.windowEnd.getTime()))
    expect(ends.size).toBe(1)
    expect([...ends][0] % WORKFLOW_ROLLUP_BUCKET_MS).toBe(0)
    expect(bounds.map((bound) => bound.windowKey)).toEqual(['24h', '7d', '30d'])
    const spans = bounds.map((bound) => bound.windowEnd.getTime() - bound.windowStart.getTime())
    expect(spans).toEqual([...spans].sort((left, right) => left - right))
  })
})

describe('listActiveWorkflowIds', () => {
  test('scopes by tenant AND organization and excludes dry runs and soft-deleted rows', async () => {
    const em = createFakeEm({
      instances: [
        instance({ workflowId: 'checkout' }),
        instance({ workflowId: 'refund' }),
        instance({ workflowId: 'dry-only', isDryRun: true }),
        instance({ workflowId: 'deleted-only', deletedAt: new Date() }),
        instance({ workflowId: 'other-org', organizationId: otherOrganizationId }),
        instance({ workflowId: 'other-tenant', tenantId: otherTenantId }),
      ],
    })

    const ids = await listActiveWorkflowIds(em as never, { tenantId, organizationId }, new Date(0))

    expect(ids).toEqual(['checkout', 'refund'])
  })
})

describe('computeDefinitionMetrics', () => {
  const windowStart = new Date('2026-07-19T00:00:00.000Z')
  const windowEnd = new Date('2026-07-21T00:00:00.000Z')
  const scope = { tenantId, organizationIds: [organizationId] }

  test('excludes dry runs from run counts, durations and the terminal classification', async () => {
    const em = createFakeEm({
      instances: [
        instance({ id: 'real', status: 'COMPLETED' }),
        instance({ id: 'dry', status: 'FAILED', isDryRun: true }),
      ],
    })

    const metrics = await computeDefinitionMetrics(em as never, scope, {
      workflowId: 'checkout',
      windowStart,
      windowEnd,
    })

    expect(metrics.runsStarted).toBe(1)
    expect(metrics.runsTerminal).toBe(1)
    expect(metrics.runsFailed).toBe(0)
    expect(metrics.successRate).toBe(1)
    expect(metrics.durationSampleCount).toBe(1)
  })

  test('never reads another tenant or another organization', async () => {
    const em = createFakeEm({
      instances: [
        instance({ id: 'mine' }),
        instance({ id: 'their-org', organizationId: otherOrganizationId }),
        instance({ id: 'their-tenant', tenantId: otherTenantId }),
      ],
    })

    const metrics = await computeDefinitionMetrics(em as never, scope, {
      workflowId: 'checkout',
      windowStart,
      windowEnd,
    })

    expect(metrics.runsStarted).toBe(1)
    for (const call of em.seenWhere) {
      expect(call.where.tenantId).toBe(tenantId)
    }
  })

  test('a terminal run outside the window does not count, however recently it started', async () => {
    const em = createFakeEm({
      instances: [
        instance({ id: 'inside' }),
        instance({ id: 'outside', completedAt: new Date('2026-07-25T00:00:00.000Z') }),
      ],
    })

    const metrics = await computeDefinitionMetrics(em as never, scope, {
      workflowId: 'checkout',
      windowStart,
      windowEnd,
    })

    expect(metrics.runsTerminal).toBe(1)
  })

  test('a CANCELLED run is terminal by its cancelledAt, which completedAt never carries', async () => {
    const em = createFakeEm({
      instances: [
        instance({
          id: 'cancelled',
          status: 'CANCELLED',
          completedAt: null,
          cancelledAt: new Date('2026-07-20T11:00:30.000Z'),
        }),
      ],
    })

    const metrics = await computeDefinitionMetrics(em as never, scope, {
      workflowId: 'checkout',
      windowStart,
      windowEnd,
    })

    expect(metrics.runsTerminal).toBe(1)
    expect(metrics.runsCancelled).toBe(1)
    expect(metrics.p95DurationMs).toBe(30_000)
  })

  test('reaches tasks only through this window\'s own instances', async () => {
    const em = createFakeEm({
      instances: [instance({ id: 'mine' })],
      tasks: [
        {
          tenantId,
          organizationId,
          workflowInstanceId: 'mine',
          status: 'COMPLETED',
          dueDate: new Date('2026-07-20T12:00:00.000Z'),
          completedAt: new Date('2026-07-20T11:30:00.000Z'),
        },
        {
          tenantId,
          organizationId,
          workflowInstanceId: 'someone-elses-instance',
          status: 'COMPLETED',
          dueDate: new Date('2026-07-20T12:00:00.000Z'),
          completedAt: new Date('2026-07-20T13:00:00.000Z'),
        },
      ],
    })

    const metrics = await computeDefinitionMetrics(em as never, scope, {
      workflowId: 'checkout',
      windowStart,
      windowEnd,
    })

    expect(metrics.tasksWithDeadline).toBe(1)
    expect(metrics.tasksMetDeadline).toBe(1)
    expect(metrics.taskSlaHitRate).toBe(1)
  })

  test('skips the task query entirely when no instance terminated in the window', async () => {
    const em = createFakeEm({ instances: [], tasks: [] })

    await computeDefinitionMetrics(em as never, scope, { workflowId: 'checkout', windowStart, windowEnd })

    expect(em.seenWhere.some((call) => call.entity === UserTask)).toBe(false)
  })
})

describe('writeRollupsForScope', () => {
  test('writes one row per (workflow, window) and stamps the scope on each', async () => {
    const em = createFakeEm({ instances: [instance({ workflowId: 'checkout' }), instance({ workflowId: 'refund' })] })

    const result = await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })

    expect(result.workflowIds).toBe(2)
    expect(result.written).toBe(6)
    const rows = em.store.get(WorkflowDefinitionMetricRollup) ?? []
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.tenantId).toBe(tenantId)
      expect(row.organizationId).toBe(organizationId)
    }
    expect(new Set(rows.map((row) => row.windowKey))).toEqual(new Set(['24h', '7d', '30d']))
  })

  test('is idempotent — a second pass in the same bucket overwrites instead of duplicating', async () => {
    const em = createFakeEm({ instances: [instance({ workflowId: 'checkout' })] })

    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })
    const afterFirst = JSON.parse(JSON.stringify(em.store.get(WorkflowDefinitionMetricRollup)))

    // A later instant inside the SAME bucket: the window boundaries floor to the
    // same values, so the pass must land on the same rows.
    const laterInSameBucket = new Date(now.getTime() + 60_000)
    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now: laterInSameBucket })
    const afterSecond = em.store.get(WorkflowDefinitionMetricRollup) ?? []

    expect(afterSecond).toHaveLength(3)
    expect(afterFirst).toHaveLength(3)
    for (let index = 0; index < afterSecond.length; index += 1) {
      expect(afterSecond[index].metrics).toEqual(afterFirst[index].metrics)
      expect(afterSecond[index].windowStart).toEqual(new Date(afterFirst[index].windowStart))
    }
  })

  test('a recomputed bucket never double-counts: run totals stay put across passes', async () => {
    const em = createFakeEm({
      instances: [instance({ workflowId: 'checkout' }), instance({ workflowId: 'checkout' })],
    })

    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })
    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })
    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })

    const rows = em.store.get(WorkflowDefinitionMetricRollup) ?? []
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect((row.metrics as { runsStarted: number }).runsStarted).toBe(2)
      expect((row.metrics as { runsTerminal: number }).runsTerminal).toBe(2)
    }
  })

  test('a new bucket adds rows rather than mutating the previous bucket in place', async () => {
    const em = createFakeEm({ instances: [instance({ workflowId: 'checkout' })] })

    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })
    await writeRollupsForScope(em as never, { tenantId, organizationId }, {
      now: new Date(now.getTime() + WORKFLOW_ROLLUP_BUCKET_MS),
    })

    expect(em.store.get(WorkflowDefinitionMetricRollup)).toHaveLength(6)
  })

  test('another organization\'s runs never reach this scope\'s rows', async () => {
    const em = createFakeEm({
      instances: [
        instance({ workflowId: 'checkout' }),
        instance({ workflowId: 'checkout', organizationId: otherOrganizationId }),
        instance({ workflowId: 'checkout', tenantId: otherTenantId }),
      ],
    })

    await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })

    const rows = em.store.get(WorkflowDefinitionMetricRollup) ?? []
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect((row.metrics as { runsStarted: number }).runsStarted).toBe(1)
    }
  })

  test('a scope with only dry runs writes nothing at all', async () => {
    const em = createFakeEm({ instances: [instance({ workflowId: 'checkout', isDryRun: true })] })

    const result = await writeRollupsForScope(em as never, { tenantId, organizationId }, { now })

    expect(result.workflowIds).toBe(0)
    expect(em.store.get(WorkflowDefinitionMetricRollup)).toHaveLength(0)
  })
})
