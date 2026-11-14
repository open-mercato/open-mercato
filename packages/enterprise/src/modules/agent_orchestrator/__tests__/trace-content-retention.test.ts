import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { AgentContextBundle, AgentSpan } from '../data/entities'

type Row = Record<string, unknown>

const mockRows = new Map<unknown, Row[]>()
const mockReportError = jest.fn()

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = row[field]
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const operators = condition as { $gte?: Date; $lt?: Date; $ne?: unknown }
      if ('$ne' in operators) return value !== operators.$ne && value !== undefined
      const time = (value as Date).getTime()
      if (operators.$gte && time < operators.$gte.getTime()) return false
      if (operators.$lt && time >= operators.$lt.getTime()) return false
      return true
    }
    return value === condition
  })
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(
    async (_em: unknown, entity: unknown, where: Row, options: { offset?: number; limit?: number } = {}) => {
      const matched = (mockRows.get(entity) ?? []).filter((row) => mockMatches(row, where))
      const offset = options.offset ?? 0
      return matched.slice(offset, offset + (options.limit ?? matched.length))
    },
  ),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

import { purgeExpiredTraceContent } from '../lib/trace/contentRetention'
import handle, { metadata } from '../workers/trace-content-retention'
import { AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE } from '../lib/queue'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-28T03:00:00.000Z')
const SCOPE_A = { tenantId: 'tenant-A', organizationId: 'org-A' }
const SCOPE_B = { tenantId: 'tenant-B', organizationId: 'org-B' }

function contentKey(daysAgo: number, label: string): string {
  return `agent-trace-content/tenant/${NOW.getTime() - daysAgo * DAY_MS}_${label}_agent_run-input.json`
}

function llmSpan(scope: typeof SCOPE_A, daysAgo: number, requestKey: string | null, responseKey: string | null): Row {
  const attributes: Row = {}
  if (requestKey) attributes['om.content.request.key'] = requestKey
  if (responseKey) attributes['om.content.response.key'] = responseKey
  return { ...scope, kind: 'llm', attributes, createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) }
}

function bundle(scope: typeof SCOPE_A, daysAgo: number, payloadRef: string | null): Row {
  return { ...scope, payloadRef, createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) }
}

type DeleteBehaviour = (key: string) => Promise<void>

function createContainer(options: { retentionDays?: number; storage?: 'available' | 'unavailable'; onDelete?: DeleteBehaviour } = {}) {
  const deletedKeys: Array<{ key: string; scope: unknown }> = []
  const service = {
    delete: jest.fn(async (input: { key: string; scope: unknown }) => {
      if (options.onDelete) await options.onDelete(input.key)
      deletedKeys.push(input)
    }),
  }
  const registrations: Record<string, unknown> = {
    moduleConfigService: {
      getRecord: async () => ({
        value: { retentionDays: options.retentionDays ?? 30 },
        source: 'tenant',
        updatedAt: null,
      }),
    },
    storageService: {
      _resolveService: async () => {
        if (options.storage === 'unavailable') throw new Error('no storage credentials')
        return service
      },
    },
  }
  const container = {
    resolve: (name: string) => registrations[name],
    hasRegistration: (name: string) => name in registrations,
  } as unknown as AwilixContainer
  return { container, service, deletedKeys }
}

const em = {} as EntityManager

beforeEach(() => {
  mockRows.clear()
  mockReportError.mockReset()
})

describe('purgeExpiredTraceContent', () => {
  it('deletes expired span and bundle content and keeps fresh keys', async () => {
    const expiredRequest = contentKey(31, 'req')
    const expiredResponse = contentKey(31, 'res')
    const expiredPayload = contentKey(33, 'ctx')
    const freshRequest = contentKey(10, 'fresh')
    mockRows.set(AgentSpan, [
      llmSpan(SCOPE_A, 31, expiredRequest, expiredResponse),
      llmSpan(SCOPE_A, 10, freshRequest, null),
    ])
    mockRows.set(AgentContextBundle, [bundle(SCOPE_A, 33, expiredPayload), bundle(SCOPE_A, 32, null)])
    const { container, deletedKeys } = createContainer()

    const result = await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(deletedKeys.map((entry) => entry.key).sort()).toEqual(
      [expiredRequest, expiredResponse, expiredPayload].sort(),
    )
    expect(deletedKeys.every((entry) => JSON.stringify(entry.scope) === JSON.stringify(SCOPE_A))).toBe(true)
    expect(result).toMatchObject({ status: 'completed', retentionDays: 30, deleted: 3, failed: 0 })
  })

  it('bounds the scan to the window before the retention cutoff', async () => {
    const beyondWindow = contentKey(45, 'old')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 45, beyondWindow, null)])
    const { container, deletedKeys } = createContainer()

    const result = await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(deletedKeys).toEqual([])
    expect(result.scannedRows).toBe(0)
  })

  it('honours the tenant retention days', async () => {
    const key = contentKey(8, 'req')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 8, key, null)])
    const { container, deletedKeys } = createContainer({ retentionDays: 7 })

    await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(deletedKeys.map((entry) => entry.key)).toEqual([key])
  })

  it('counts an already-missing object as deleted', async () => {
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, contentKey(31, 'gone'), null)])
    const missing = Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
    const { container } = createContainer({
      onDelete: async () => {
        throw missing
      },
    })

    const result = await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(result).toMatchObject({ status: 'completed', deleted: 1, failed: 0 })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('skips the scope when storage is unavailable', async () => {
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, contentKey(31, 'req'), contentKey(31, 'res'))])
    const { container, service } = createContainer({ storage: 'unavailable' })

    const result = await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(result).toMatchObject({ status: 'storage_unavailable', deleted: 0, failed: 0 })
    expect(service.delete).not.toHaveBeenCalled()
  })

  it('reports a per-key failure and keeps deleting the rest of the batch', async () => {
    const failing = contentKey(31, 'boom')
    const healthy = contentKey(31, 'ok')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, failing, null), llmSpan(SCOPE_A, 31, healthy, null)])
    const failure = new Error('access denied')
    const { container, deletedKeys } = createContainer({
      onDelete: async (key) => {
        if (key === failing) throw failure
      },
    })

    const result = await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(deletedKeys.map((entry) => entry.key)).toEqual([healthy])
    expect(result).toMatchObject({ status: 'completed', deleted: 1, failed: 1 })
    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      code: 'agent_orchestrator.trace_content_retention_delete_failed',
    }))
  })

  it('pages through rows in batches', async () => {
    const keys = [1, 2, 3, 4, 5].map((index) => contentKey(31, `req${index}`))
    mockRows.set(AgentSpan, keys.map((key) => llmSpan(SCOPE_A, 31, key, null)))
    const { container, deletedKeys } = createContainer()

    const result = await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW, batchSize: 2 })

    expect(deletedKeys.map((entry) => entry.key).sort()).toEqual([...keys].sort())
    expect(result.scannedRows).toBe(5)
  })

  it('never touches another tenant content', async () => {
    const ownKey = contentKey(31, 'own')
    const foreignKey = contentKey(31, 'foreign')
    const foreignPayload = contentKey(31, 'foreign-ctx')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, ownKey, null), llmSpan(SCOPE_B, 31, foreignKey, null)])
    mockRows.set(AgentContextBundle, [bundle(SCOPE_B, 31, foreignPayload)])
    const { container, deletedKeys } = createContainer()

    await purgeExpiredTraceContent(container, em, SCOPE_A, { now: NOW })

    expect(deletedKeys.map((entry) => entry.key)).toEqual([ownKey])
  })
})

describe('trace content retention worker', () => {
  it('runs on its own queue with concurrency 1', () => {
    expect(metadata).toEqual({
      queue: AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
      id: 'agent_orchestrator:trace-content-retention',
      concurrency: 1,
    })
  })

  it('ignores a job without a full scope', async () => {
    await expect(
      handle({ payload: { scope: { tenantId: '', organizationId: 'org-A' } } } as never, {} as never),
    ).resolves.toBeUndefined()
  })
})
