import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BatchingAccessAuditLogger,
  FormsAccessAuditLogger,
  resolveAccessAuditBatchMs,
  type AccessAuditEvent,
} from '../services/access-audit-logger'
import { FormAccessAudit } from '../data/entities'

type CreatedRow = Record<string, unknown>

function makeFakeEm(options: { flushError?: Error } = {}): {
  em: EntityManager
  persisted: CreatedRow[]
  flushCount: () => number
} {
  const persisted: CreatedRow[] = []
  let flushCalls = 0
  const em = {
    create: (_entity: unknown, data: CreatedRow) => data,
    persist: (row: CreatedRow) => {
      persisted.push(row)
    },
    flush: async () => {
      flushCalls += 1
      if (options.flushError) throw options.flushError
    },
  } as unknown as EntityManager
  return { em, persisted, flushCount: () => flushCalls }
}

const baseEvent: AccessAuditEvent = {
  organizationId: 'org-1',
  submissionId: 'sub-1',
  accessedBy: 'user-1',
  accessPurpose: 'view',
}

describe('resolveAccessAuditBatchMs', () => {
  it('defaults to 0 (synchronous) when unset or blank', () => {
    expect(resolveAccessAuditBatchMs({})).toBe(0)
    expect(resolveAccessAuditBatchMs({ FORMS_ACCESS_AUDIT_BATCH_MS: '' })).toBe(0)
    expect(resolveAccessAuditBatchMs({ FORMS_ACCESS_AUDIT_BATCH_MS: '  ' })).toBe(0)
  })

  it('parses positive integers', () => {
    expect(resolveAccessAuditBatchMs({ FORMS_ACCESS_AUDIT_BATCH_MS: '1000' })).toBe(1000)
  })

  it('clamps invalid / negative values to 0', () => {
    expect(resolveAccessAuditBatchMs({ FORMS_ACCESS_AUDIT_BATCH_MS: 'nope' })).toBe(0)
    expect(resolveAccessAuditBatchMs({ FORMS_ACCESS_AUDIT_BATCH_MS: '-50' })).toBe(0)
  })
})

describe('FormsAccessAuditLogger (synchronous)', () => {
  it('inserts + flushes immediately on the request EM', async () => {
    const { em, persisted, flushCount } = makeFakeEm()
    const logger = new FormsAccessAuditLogger()
    await logger.log(em, baseEvent)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      organizationId: 'org-1',
      submissionId: 'sub-1',
      accessedBy: 'user-1',
      accessPurpose: 'view',
    })
    expect(flushCount()).toBe(1)
  })
})

describe('BatchingAccessAuditLogger', () => {
  beforeEach(() => {
    BatchingAccessAuditLogger.reset()
  })
  afterEach(() => {
    BatchingAccessAuditLogger.reset()
    jest.useRealTimers()
  })

  it('synchronous mode (batchMs=0) writes immediately on the request EM', async () => {
    const { em, persisted, flushCount } = makeFakeEm()
    const logger = new BatchingAccessAuditLogger({
      batchMs: 0,
      emFactory: () => {
        throw new Error('factory must not be used in sync mode')
      },
    })
    await logger.log(em, baseEvent)
    expect(persisted).toHaveLength(1)
    expect(flushCount()).toBe(1)
    expect(BatchingAccessAuditLogger.bufferedCount).toBe(0)
  })

  it('buffers events in batched mode and flushes on flush()', async () => {
    const { em, persisted } = makeFakeEm()
    const requestEm = { flush: async () => { throw new Error('request EM must not flush') } } as unknown as EntityManager
    const logger = new BatchingAccessAuditLogger({
      batchMs: 1000,
      emFactory: () => em,
    })

    await logger.log(requestEm, baseEvent)
    await logger.log(requestEm, { ...baseEvent, submissionId: 'sub-2' })
    // Nothing persisted yet — purely buffered, request EM untouched.
    expect(persisted).toHaveLength(0)
    expect(BatchingAccessAuditLogger.bufferedCount).toBe(2)

    await logger.flush()
    expect(persisted).toHaveLength(2)
    expect(persisted.map((row) => row.submissionId)).toEqual(['sub-1', 'sub-2'])
    expect(BatchingAccessAuditLogger.bufferedCount).toBe(0)
  })

  it('uses the fresh-EM factory (never the request EM) at flush time', async () => {
    const fresh = makeFakeEm()
    const factory = jest.fn(() => fresh.em)
    const logger = new BatchingAccessAuditLogger({ batchMs: 1000, emFactory: factory })
    const requestEm = makeFakeEm()

    await logger.log(requestEm.em, baseEvent)
    expect(factory).not.toHaveBeenCalled()
    await logger.flush()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(fresh.persisted).toHaveLength(1)
    expect(requestEm.persisted).toHaveLength(0)
  })

  it('flushes on a timer when the interval elapses', async () => {
    jest.useFakeTimers()
    const { em, persisted } = makeFakeEm()
    const logger = new BatchingAccessAuditLogger({ batchMs: 500, emFactory: () => em })

    await logger.log({} as EntityManager, baseEvent)
    expect(persisted).toHaveLength(0)

    jest.advanceTimersByTime(500)
    // Allow the timer callback's async flush to settle.
    await Promise.resolve()
    await Promise.resolve()
    expect(persisted).toHaveLength(1)
  })

  it('flushes early when the buffer hits the size cap', async () => {
    const { em, persisted } = makeFakeEm()
    const logger = new BatchingAccessAuditLogger({
      batchMs: 100000,
      maxBufferSize: 3,
      emFactory: () => em,
    })
    for (let index = 0; index < 3; index += 1) {
      await logger.log({} as EntityManager, { ...baseEvent, submissionId: `sub-${index}` })
    }
    // Cap reached on the 3rd — flush scheduled synchronously, settle it.
    await Promise.resolve()
    await Promise.resolve()
    expect(persisted).toHaveLength(3)
    expect(BatchingAccessAuditLogger.bufferedCount).toBe(0)
  })

  it('is fail-soft: a flush insert error drops events without throwing', async () => {
    const warn = jest.fn()
    const { em } = makeFakeEm({ flushError: new Error('db down') })
    const logger = new BatchingAccessAuditLogger({
      batchMs: 1000,
      emFactory: () => em,
      logger: { warn },
    })
    await logger.log({} as EntityManager, baseEvent)
    await expect(logger.flush()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatchObject({ event: 'forms.access_audit.flush_failed', dropped: 1 })
    expect(BatchingAccessAuditLogger.bufferedCount).toBe(0)
  })

  it('captures all scope fields on the buffered event for deferred write', async () => {
    const { em, persisted } = makeFakeEm()
    const logger = new BatchingAccessAuditLogger({
      batchMs: 1000,
      emFactory: () => em,
      now: () => new Date('2026-05-21T12:00:00Z'),
    })
    await logger.log({} as EntityManager, {
      organizationId: 'org-9',
      submissionId: 'sub-9',
      accessedBy: 'user-9',
      accessPurpose: 'export',
      ip: '10.0.0.1',
      ua: 'jest',
      revisionId: 'rev-9',
    })
    await logger.flush()
    expect(persisted[0]).toMatchObject({
      organizationId: 'org-9',
      submissionId: 'sub-9',
      accessedBy: 'user-9',
      accessPurpose: 'export',
      ip: '10.0.0.1',
      ua: 'jest',
      revisionId: 'rev-9',
      accessedAt: new Date('2026-05-21T12:00:00Z'),
    })
  })

  it('targets the FormAccessAudit entity', async () => {
    const createCalls: unknown[] = []
    const em = {
      create: (entity: unknown, data: CreatedRow) => {
        createCalls.push(entity)
        return data
      },
      persist: () => {},
      flush: async () => {},
    } as unknown as EntityManager
    const logger = new BatchingAccessAuditLogger({ batchMs: 1000, emFactory: () => em })
    await logger.log({} as EntityManager, baseEvent)
    await logger.flush()
    expect(createCalls[0]).toBe(FormAccessAudit)
  })
})
