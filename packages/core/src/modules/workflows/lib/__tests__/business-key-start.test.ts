import fs from 'node:fs'
import path from 'node:path'
import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { UniqueConstraintViolationException, type EntityManager } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    async (
      em: { findOne: (...args: unknown[]) => Promise<unknown> },
      entity: unknown,
      where: unknown,
      options: unknown,
      scope?: { tenantId?: string | null; organizationId?: string | null },
    ) => {
      const row = (await em.findOne(entity, where, options)) as Record<string, unknown> | null
      const context = row?.context as { ciphertext?: string } | undefined
      if (!row || !context?.ciphertext) return row
      if (scope?.tenantId !== row.tenantId || scope?.organizationId !== row.organizationId) return row
      return { ...row, context: { customerEmail: context.ciphertext.replace(/^enc:/, '') } }
    },
  ),
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

let clock = 0

function buildInstance(id: string, status: WorkflowInstanceStatus): WorkflowInstance {
  clock += 1
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
    deletedAt: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)),
  } as unknown as WorkflowInstance
}

type FilterValue = unknown | { $ne?: unknown; $nin?: unknown[] }

function matchesWhere(row: Record<string, unknown>, where: Record<string, FilterValue>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key] ?? null
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const operators = condition as { $ne?: unknown; $nin?: unknown[] }
      if ('$ne' in operators && value === operators.$ne) return false
      if (operators.$nin && operators.$nin.includes(value)) return false
      return true
    }
    return value === condition
  })
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
  let store: WorkflowInstance[]
  let pending: WorkflowInstance[]
  let createdData: Array<Record<string, unknown>>
  let beforeInsert: (() => void) | null

  beforeEach(() => {
    store = []
    pending = []
    createdData = []
    beforeInsert = null
    em = {
      findOne: jest.fn(async (entity: unknown, where: unknown) => {
        if (entity === WorkflowDefinition) return definition
        if (entity !== WorkflowInstance) return null
        const rows = store
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where as Record<string, FilterValue>))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        return rows[0] ?? null
      }),
      create: jest.fn((entity: unknown, data: unknown) => {
        if (entity === WorkflowInstance) {
          createdData.push(data as Record<string, unknown>)
          return { id: 'created-instance', deletedAt: null, ...(data as Record<string, unknown>) }
        }
        return { ...(data as Record<string, unknown>) }
      }),
      persist: jest.fn((entity: unknown) => {
        if ((entity as { businessKey?: unknown })?.businessKey !== undefined) pending.push(entity as WorkflowInstance)
        return em
      }),
      flush: jest.fn(async () => {
        if (pending.length > 0) {
          beforeInsert?.()
          beforeInsert = null
          store.push(...pending)
          pending = []
        }
      }),
      transactional: jest.fn(async (callback) => {
        try {
          return await callback(em)
        } catch (error) {
          store = store.filter((row) => row.id !== 'created-instance')
          throw error
        }
      }),
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
    store.push(running)

    const result = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate' })

    expect(result).toEqual({ instance: running, created: false })
    expect(createdData).toHaveLength(0)
  })

  test('reject_duplicate (default) returns an ended instance instead of starting again', async () => {
    const completed = buildInstance('completed-instance', 'COMPLETED')
    store.push(completed)

    const result = await start({ businessKey: 'order:42' })

    expect(result).toEqual({ instance: completed, created: false })
    expect(createdData).toHaveLength(0)
  })

  test('allow_duplicate starts a new run once the previous one ended', async () => {
    store.push(buildInstance('completed-instance', 'COMPLETED'))

    const result = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate' })

    expect(result.created).toBe(true)
    expect(createdData).toHaveLength(1)
  })

  test('allow_duplicate_failed_only reuses the key after a failure but not after a success', async () => {
    store.push(buildInstance('failed-instance', 'FAILED'))
    const afterFailure = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate_failed_only' })
    expect(afterFailure.created).toBe(true)

    store.splice(0, store.length)
    const completed = buildInstance('completed-instance', 'COMPLETED')
    store.push(completed)
    const afterSuccess = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate_failed_only' })
    expect(afterSuccess).toEqual({ instance: completed, created: false })
  })

  describe('a retried older run reopens the key after a newer run reused it and completed', () => {
    let retriedA: WorkflowInstance
    let completedB: WorkflowInstance

    beforeEach(() => {
      retriedA = buildInstance('instance-a', 'FAILED')
      completedB = buildInstance('instance-b', 'COMPLETED')
      store.push(retriedA, completedB)
      retriedA.status = 'RUNNING'
    })

    test.each(['reject_duplicate', 'allow_duplicate', 'allow_duplicate_failed_only'] as const)(
      '%s returns the running A, never the newer finished B',
      async (reusePolicy) => {
        const result = await start({ businessKey: 'order:42', reusePolicy })

        expect(result).toEqual({ instance: retriedA, created: false })
        expect(createdData).toHaveLength(0)
      },
    )

    test('the unique-violation fallback returns the running A, never the newer finished B', async () => {
      retriedA.status = 'FAILED'
      em.transactional.mockImplementationOnce(async () => {
        retriedA.status = 'RUNNING'
        throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
      })

      const result = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate' })

      expect(result).toEqual({ instance: retriedA, created: false })
    })
  })

  describe('holder reads go through the caller-scoped decryption helper', () => {
    const encryptedHolder = (id: string, status: WorkflowInstanceStatus) => {
      const holder = buildInstance(id, status)
      ;(holder as unknown as { context: unknown }).context = { ciphertext: 'enc:jane@example.com' }
      return holder
    }

    const expectScopedDecryptionReads = () => {
      const instanceReads = (findOneWithDecryption as unknown as jest.Mock).mock.calls.filter(
        ([, entity]) => entity === WorkflowInstance,
      )
      expect(instanceReads.length).toBeGreaterThan(0)
      for (const call of instanceReads) {
        expect(call[4]).toEqual({ tenantId, organizationId })
      }
    }

    beforeEach(() => {
      ;(findOneWithDecryption as unknown as jest.Mock).mockClear()
    })

    test('a reused open holder comes back with its encrypted fields decrypted', async () => {
      store.push(encryptedHolder('encrypted-open', 'RUNNING'))

      const result = await start({ businessKey: 'order:42' })

      expect(result.created).toBe(false)
      expect(result.instance.id).toBe('encrypted-open')
      expect(result.instance.context).toEqual({ customerEmail: 'jane@example.com' })
      expectScopedDecryptionReads()
    })

    test('a reused ended holder comes back decrypted', async () => {
      store.push(encryptedHolder('encrypted-ended', 'COMPLETED'))

      const result = await start({ businessKey: 'order:42' })

      expect(result.instance.id).toBe('encrypted-ended')
      expect(result.instance.context).toEqual({ customerEmail: 'jane@example.com' })
      expectScopedDecryptionReads()
    })

    test('the unique-violation fallback returns the winner decrypted', async () => {
      em.transactional.mockImplementationOnce(async () => {
        store.push(encryptedHolder('encrypted-winner', 'RUNNING'))
        throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
      })

      const result = await start({ businessKey: 'order:42' })

      expect(result).toEqual({
        instance: expect.objectContaining({ id: 'encrypted-winner', context: { customerEmail: 'jane@example.com' } }),
        created: false,
      })
      expectScopedDecryptionReads()
    })
  })

  test('a concurrent winner turns the unique violation into the winner instance', async () => {
    const winner = buildInstance('winner-instance', 'RUNNING')
    em.transactional.mockImplementationOnce(async () => {
      store.push(winner)
      throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
    })

    const result = await start({ businessKey: 'order:42' })

    expect(result).toEqual({ instance: winner, created: false })
  })

  test('a holder that started and ended between the pre-check and the insert rolls the insert back', async () => {
    const endedConcurrently = buildInstance('concurrent-instance', 'COMPLETED')
    beforeInsert = () => {
      store.push(endedConcurrently)
    }

    const result = await start({ businessKey: 'order:42' })

    expect(result).toEqual({ instance: endedConcurrently, created: false })
    expect(store.map((row) => row.id)).toEqual(['concurrent-instance'])
    expect(em.findOne).toHaveBeenLastCalledWith(
      WorkflowInstance,
      expect.objectContaining({ businessKey: 'order:42', id: { $ne: 'created-instance' } }),
      { orderBy: { createdAt: 'DESC' } },
    )
  })

  test('the post-insert re-check keeps the new run when the policy allows starting past the holder', async () => {
    beforeInsert = () => {
      store.push(buildInstance('concurrent-instance', 'COMPLETED'))
    }

    const result = await start({ businessKey: 'order:42', reusePolicy: 'allow_duplicate' })

    expect(result.created).toBe(true)
    expect(result.instance.id).toBe('created-instance')
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
    store.push(running)

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
