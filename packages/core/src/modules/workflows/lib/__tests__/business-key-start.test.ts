import fs from 'node:fs'
import path from 'node:path'
import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { UniqueConstraintViolationException, type EntityManager } from '@mikro-orm/core'
import * as workflowExecutor from '../workflow-executor'
import {
  WorkflowDefinition,
  WorkflowInstance,
  type WorkflowInstanceStatus,
} from '../../data/entities'
import {
  canStartNewInstanceForBusinessKey,
  normalizeBusinessKey,
  WORKFLOW_TERMINAL_INSTANCE_STATUSES,
} from '../business-key'

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

jest.mock('../step-handler', () => ({
  executeStep: jest.fn(),
}))

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'

const definition = {
  id: definitionId,
  workflowId: 'keyed-workflow',
  workflowName: 'Keyed Workflow',
  version: 1,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 'start-to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto', priority: 0 },
    ],
  },
  tenantId,
  organizationId,
} as unknown as WorkflowDefinition

function buildInstance(id: string, status: WorkflowInstanceStatus): WorkflowInstance {
  return {
    id,
    definitionId,
    workflowId: 'keyed-workflow',
    version: 1,
    status,
    currentStepId: 'start',
    context: {},
    businessKey: 'order:42',
    tenantId,
    organizationId,
  } as unknown as WorkflowInstance
}

type MockEm = {
  findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>
  create: jest.Mock<(...args: unknown[]) => unknown>
  persist: jest.Mock<(...args: unknown[]) => unknown>
  flush: jest.Mock<(...args: unknown[]) => Promise<void>>
  transactional: jest.Mock<(callback: (trx: unknown) => Promise<unknown>) => Promise<unknown>>
}

describe('startOrReuseWorkflow with a business key', () => {
  let em: MockEm
  let keyedLookups: Array<WorkflowInstance | null>
  let createdData: Array<Record<string, unknown>>

  beforeEach(() => {
    keyedLookups = []
    createdData = []
    em = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === WorkflowDefinition) return definition
        if (entity === WorkflowInstance) return keyedLookups.length > 0 ? keyedLookups.shift() ?? null : null
        return null
      }),
      create: jest.fn((entity: unknown, data: unknown) => {
        if (entity === WorkflowInstance) {
          createdData.push(data as Record<string, unknown>)
          return { id: 'created-instance', ...(data as Record<string, unknown>) }
        }
        return { ...(data as Record<string, unknown>) }
      }),
      persist: jest.fn(function persist(this: unknown) { return em }),
      flush: jest.fn(async () => undefined),
      transactional: jest.fn(async (callback) => callback(em)),
    }
  })

  const start = (options: Partial<workflowExecutor.StartWorkflowOptions> = {}) =>
    workflowExecutor.startOrReuseWorkflow(em as unknown as EntityManager, {
      workflowId: 'keyed-workflow',
      tenantId,
      organizationId,
      ...options,
    })

  test('creates and stores the trimmed key when nothing holds it', async () => {
    const result = await start({ businessKey: '  order:42  ' })

    expect(result.created).toBe(true)
    expect(result.instance.id).toBe('created-instance')
    expect(createdData[0]?.businessKey).toBe('order:42')
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(
      WorkflowInstance,
      expect.objectContaining({ tenantId, organizationId, workflowId: 'keyed-workflow', businessKey: 'order:42', deletedAt: null }),
      { orderBy: { createdAt: 'DESC' } },
    )
  })

  test('returns the open instance holding the key without creating another', async () => {
    const running = buildInstance('running-instance', 'PAUSED')
    keyedLookups.push(running)

    const result = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate' })

    expect(result).toEqual({ instance: running, created: false })
    expect(createdData).toHaveLength(0)
  })

  test('reject_duplicate (default) returns an ended instance instead of starting again', async () => {
    const completed = buildInstance('completed-instance', 'COMPLETED')
    keyedLookups.push(completed)

    const result = await start({ businessKey: 'order:42' })

    expect(result).toEqual({ instance: completed, created: false })
    expect(createdData).toHaveLength(0)
  })

  test('allow_duplicate starts a new run once the previous one ended', async () => {
    keyedLookups.push(buildInstance('completed-instance', 'COMPLETED'))

    const result = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate' })

    expect(result.created).toBe(true)
    expect(createdData).toHaveLength(1)
  })

  test('allow_duplicate_failed_only reuses the key after a failure but not after a success', async () => {
    keyedLookups.push(buildInstance('failed-instance', 'FAILED'))
    const afterFailure = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate_failed_only' })
    expect(afterFailure.created).toBe(true)

    const completed = buildInstance('completed-instance', 'COMPLETED')
    keyedLookups.push(completed)
    const afterSuccess = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate_failed_only' })
    expect(afterSuccess).toEqual({ instance: completed, created: false })
  })

  test('a concurrent winner turns the unique violation into the winner instance', async () => {
    const winner = buildInstance('winner-instance', 'RUNNING')
    keyedLookups.push(null as unknown as WorkflowInstance, winner)
    em.transactional.mockImplementationOnce(async () => {
      throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
    })

    const result = await start({ businessKey: 'order:42' })

    expect(result).toEqual({ instance: winner, created: false })
  })

  test('a unique violation with no winner to read is rethrown', async () => {
    const violation = new UniqueConstraintViolationException(new Error('duplicate key'))
    em.transactional.mockImplementationOnce(async () => {
      throw violation
    })

    await expect(start({ businessKey: 'order:42' })).rejects.toBe(violation)
  })

  test('rejects an empty key, an over-long key and a key on a dry run', async () => {
    await expect(start({ businessKey: '   ' })).rejects.toMatchObject({ code: 'INVALID_BUSINESS_KEY' })
    await expect(start({ businessKey: 'x'.repeat(256) })).rejects.toMatchObject({ code: 'INVALID_BUSINESS_KEY' })
    await expect(start({ businessKey: 'order:42', isDryRun: true })).rejects.toMatchObject({ code: 'INVALID_BUSINESS_KEY' })
    expect(createdData).toHaveLength(0)
  })

  test('without a key the historic path runs: no lookup, no nested transaction', async () => {
    const result = await start({ reusePolicy: 'allow_duplicate' })

    expect(result.created).toBe(true)
    expect(em.transactional).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalledWith(WorkflowInstance, expect.anything(), expect.anything())
    expect(createdData[0]).not.toHaveProperty('businessKey')
  })

  test('startWorkflow keeps returning the bare instance', async () => {
    const running = buildInstance('running-instance', 'RUNNING')
    keyedLookups.push(running)

    const instance = await workflowExecutor.startWorkflow(em as unknown as EntityManager, {
      workflowId: 'keyed-workflow',
      businessKey: 'order:42',
      tenantId,
      organizationId,
    })

    expect(instance).toBe(running)
  })
})

describe('business-key helpers', () => {
  test('normalizeBusinessKey', () => {
    expect(normalizeBusinessKey(undefined)).toEqual({ ok: true, businessKey: null })
    expect(normalizeBusinessKey(null)).toEqual({ ok: true, businessKey: null })
    expect(normalizeBusinessKey(' a ')).toEqual({ ok: true, businessKey: 'a' })
    expect(normalizeBusinessKey('')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeBusinessKey('x'.repeat(255))).toEqual({ ok: true, businessKey: 'x'.repeat(255) })
    expect(normalizeBusinessKey('x'.repeat(256))).toEqual({ ok: false, reason: 'tooLong' })
  })

  test('an open instance never yields to a new run, whatever the policy', () => {
    for (const status of ['RUNNING', 'PAUSED', 'WAITING_FOR_ACTIVITIES', 'FORKED', 'COMPENSATING'] as const) {
      expect(canStartNewInstanceForBusinessKey('allow_duplicate', status)).toBe(false)
      expect(canStartNewInstanceForBusinessKey('allow_duplicate_failed_only', status)).toBe(false)
      expect(canStartNewInstanceForBusinessKey('reject_duplicate', status)).toBe(false)
    }
  })

  test('the terminal set matches the partial unique index predicate in the entity and the migration', () => {
    const expected = `"status" not in (${WORKFLOW_TERMINAL_INSTANCE_STATUSES.map((status) => `'${status}'`).join(', ')})`
    const moduleRoot = path.resolve(__dirname, '../..')
    const sources = [
      fs.readFileSync(path.join(moduleRoot, 'data/entities.ts'), 'utf8'),
      fs.readFileSync(path.join(moduleRoot, 'migrations/Migration20261011090000_workflows.ts'), 'utf8'),
    ]
    for (const source of sources) {
      const indexLine = source.split('\n').find((line) => line.includes('create unique index "workflow_instances_business_key_open_uq"'))
      expect(indexLine).toContain(expected)
    }
  })
})
