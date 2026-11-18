import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { AgentContextBundle, AgentSpan } from '../data/entities'

type Row = Record<string, unknown>

const mockRows = new Map<unknown, Row[]>()
const mockReportError = jest.fn()

function mockCompare(value: unknown, operand: unknown): number {
  if (value instanceof Date && operand instanceof Date) return value.getTime() - operand.getTime()
  return String(value).localeCompare(String(operand))
}

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === '$and') return (condition as Row[]).every((part) => mockMatches(row, part))
    if (field === '$or') return (condition as Row[]).some((part) => mockMatches(row, part))
    const value = row[field]
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
    if (condition && typeof condition === 'object') {
      const operators = condition as { $gt?: unknown; $gte?: unknown; $lt?: unknown; $ne?: unknown }
      if ('$ne' in operators) return value !== operators.$ne && value !== undefined
      if (operators.$gt !== undefined && mockCompare(value, operators.$gt) <= 0) return false
      if (operators.$gte !== undefined && mockCompare(value, operators.$gte) < 0) return false
      if (operators.$lt !== undefined && mockCompare(value, operators.$lt) >= 0) return false
      return true
    }
    return value === condition
  })
}

function mockSortByCreatedAtThenId(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => mockCompare(left.createdAt, right.createdAt) || mockCompare(left.id, right.id))
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(
    async (_em: unknown, entity: unknown, where: Row, options: { offset?: number; limit?: number } = {}) => {
      const matched = mockSortByCreatedAtThenId((mockRows.get(entity) ?? []).filter((row) => mockMatches(row, where)))
      const offset = options.offset ?? 0
      return matched.slice(offset, offset + (options.limit ?? matched.length))
    },
  ),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

import {
  createModuleConfigTraceContentRetentionCursorStore,
  purgeExpiredTraceContent,
  type TraceContentRetentionCursorPosition,
  type TraceContentRetentionCursorStore,
} from '../lib/trace/contentRetention'
import handle, { metadata } from '../workers/trace-content-retention'
import { AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE } from '../lib/queue'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-28T03:00:00.000Z')
const SCOPE_A = { tenantId: 'tenant-A', organizationId: 'org-A' }
const SCOPE_B = { tenantId: 'tenant-B', organizationId: 'org-B' }

function contentKey(daysAgo: number, label: string): string {
  return `agent-trace-content/tenant/${NOW.getTime() - daysAgo * DAY_MS}_${label}_agent_run-input.json`
}

let rowSequence = 0

function nextRowId(): string {
  rowSequence += 1
  return `00000000-0000-4000-8000-${String(rowSequence).padStart(12, '0')}`
}

function llmSpan(scope: typeof SCOPE_A, daysAgo: number, requestKey: string | null, responseKey: string | null): Row {
  const attributes: Row = {}
  if (requestKey) attributes['om.content.request.key'] = requestKey
  if (responseKey) attributes['om.content.response.key'] = responseKey
  return { id: nextRowId(), ...scope, kind: 'llm', attributes, createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) }
}

function bundle(scope: typeof SCOPE_A, daysAgo: number, payloadRef: string | null): Row {
  return { id: nextRowId(), ...scope, payloadRef, createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) }
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

function createCursorStore() {
  const positions = new Map<string, TraceContentRetentionCursorPosition>()
  const store: TraceContentRetentionCursorStore = {
    read: jest.fn(async (scope, source) => positions.get(`${scope.tenantId}/${scope.organizationId}/${source}`) ?? null),
    write: jest.fn(async (scope, source, position) => {
      positions.set(`${scope.tenantId}/${scope.organizationId}/${source}`, position)
    }),
  }
  return { store, positions }
}

const em = {} as EntityManager

let cursors: ReturnType<typeof createCursorStore>

function purge(container: AwilixContainer, scope = SCOPE_A, options: Parameters<typeof purgeExpiredTraceContent>[3] = {}) {
  return purgeExpiredTraceContent(container, em, scope, { now: NOW, cursorStore: cursors.store, ...options })
}

beforeEach(() => {
  mockRows.clear()
  mockReportError.mockReset()
  cursors = createCursorStore()
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

    const result = await purge(container)

    expect(deletedKeys.map((entry) => entry.key).sort()).toEqual(
      [expiredRequest, expiredResponse, expiredPayload].sort(),
    )
    expect(deletedKeys.every((entry) => JSON.stringify(entry.scope) === JSON.stringify(SCOPE_A))).toBe(true)
    expect(result).toMatchObject({ status: 'completed', retentionDays: 30, deleted: 3, failed: 0 })
  })

  it('sweeps content older than seven days past the cutoff (missed runs, first run)', async () => {
    const beyondOldWindow = contentKey(45, 'old')
    const muchOlder = contentKey(400, 'ancient')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 45, beyondOldWindow, null), llmSpan(SCOPE_A, 400, muchOlder, null)])
    const { container, deletedKeys } = createContainer()

    const result = await purge(container)

    expect(deletedKeys.map((entry) => entry.key).sort()).toEqual([beyondOldWindow, muchOlder].sort())
    expect(result).toMatchObject({ status: 'completed', scannedRows: 2, deleted: 2 })
  })

  it('catches up after retentionDays is lowered', async () => {
    const keys = [35, 50, 89].map((daysAgo) => contentKey(daysAgo, `req${daysAgo}`))
    mockRows.set(AgentSpan, [35, 50, 89].map((daysAgo, index) => llmSpan(SCOPE_A, daysAgo, keys[index], null)))
    const { container: before, deletedKeys: deletedBefore } = createContainer({ retentionDays: 90 })
    await purge(before)
    expect(deletedBefore).toEqual([])

    const { container: after, deletedKeys: deletedAfter } = createContainer({ retentionDays: 30 })
    await purge(after)

    expect(deletedAfter.map((entry) => entry.key).sort()).toEqual([...keys].sort())
  })

  it('resumes from the cursor when one run cannot reach the end of the backlog', async () => {
    const keys = [1, 2, 3, 4, 5].map((index) => contentKey(40 + index, `req${index}`))
    mockRows.set(AgentSpan, keys.map((key, index) => llmSpan(SCOPE_A, 40 + index, key, null)))
    const deleted: string[] = []
    for (let run = 0; run < 3; run += 1) {
      const { container, deletedKeys } = createContainer()
      await purge(container, SCOPE_A, { batchSize: 2, maxBatches: 1 })
      deleted.push(...deletedKeys.map((entry) => entry.key))
    }

    expect(deleted.sort()).toEqual([...keys].sort())
    expect(new Set(deleted).size).toBe(keys.length)
  })

  it('does not re-delete rows a previous run already swept', async () => {
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, contentKey(31, 'req'), null)])
    mockRows.set(AgentContextBundle, [bundle(SCOPE_A, 32, contentKey(32, 'ctx'))])
    const { container: first } = createContainer()
    await purge(first)

    const { container: second, service } = createContainer()
    const result = await purge(second)

    expect(service.delete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ scannedRows: 0, deleted: 0 })
  })

  it('advances past a failing key, reports it, and still deletes a later expired row in the same run', async () => {
    const failing = contentKey(33, 'boom')
    const after = contentKey(32, 'after')
    const failingRow = llmSpan(SCOPE_A, 33, failing, null)
    const afterRow = llmSpan(SCOPE_A, 32, after, null)
    mockRows.set(AgentSpan, [failingRow, afterRow])
    const failure = new Error('access denied')
    const { container, deletedKeys } = createContainer({
      onDelete: async (key) => {
        if (key === failing) throw failure
      },
    })

    const result = await purge(container, SCOPE_A, { batchSize: 1 })

    expect(result).toMatchObject({ status: 'completed', scannedRows: 2, deleted: 1, failed: 1 })
    expect(deletedKeys.map((entry) => entry.key)).toEqual([after])
    expect(cursors.positions.get('tenant-A/org-A/llm_span')).toEqual({
      createdAt: afterRow.createdAt,
      rowId: afterRow.id,
    })
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.trace_content_retention_delete_failed',
      attributes: { tenantId: SCOPE_A.tenantId, organizationId: SCOPE_A.organizationId },
    })
  })

  it('does not revisit a row whose delete failed on a later run', async () => {
    const failing = contentKey(33, 'boom')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 33, failing, null)])
    const { container: broken } = createContainer({
      onDelete: async (key) => {
        if (key === failing) throw new Error('access denied')
      },
    })
    const first = await purge(broken)
    expect(first).toMatchObject({ deleted: 0, failed: 1 })

    const { container: healthy, service } = createContainer()
    const second = await purge(healthy)

    expect(service.delete).not.toHaveBeenCalled()
    expect(second).toMatchObject({ scannedRows: 0, deleted: 0, failed: 0 })
  })

  it('holds the cursor at a pre-cutoff row whose key has not expired yet', async () => {
    const uploadedLater = `agent-trace-content/tenant/${NOW.getTime() - 29 * DAY_MS}_late_agent_run-input.json`
    const row = { ...llmSpan(SCOPE_A, 31, uploadedLater, null) }
    mockRows.set(AgentSpan, [row])
    const { container, deletedKeys } = createContainer()

    await purge(container)

    expect(deletedKeys).toEqual([])
    expect(cursors.store.write).not.toHaveBeenCalled()

    const { container: later, deletedKeys: deletedLater } = createContainer()
    await purge(later, SCOPE_A, { now: new Date(NOW.getTime() + 2 * DAY_MS) })
    expect(deletedLater.map((entry) => entry.key)).toEqual([uploadedLater])
  })

  it('keeps per-scope cursors apart', async () => {
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, contentKey(31, 'own'), null), llmSpan(SCOPE_B, 31, contentKey(31, 'other'), null)])
    const { container } = createContainer()

    await purge(container, SCOPE_A)

    expect([...cursors.positions.keys()]).toEqual(['tenant-A/org-A/llm_span'])
  })

  it('honours the tenant retention days', async () => {
    const key = contentKey(8, 'req')
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 8, key, null)])
    const { container, deletedKeys } = createContainer({ retentionDays: 7 })

    await purge(container)

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

    const result = await purge(container)

    expect(result).toMatchObject({ status: 'completed', deleted: 1, failed: 0 })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('skips the scope when storage is unavailable', async () => {
    mockRows.set(AgentSpan, [llmSpan(SCOPE_A, 31, contentKey(31, 'req'), contentKey(31, 'res'))])
    const { container, service } = createContainer({ storage: 'unavailable' })

    const result = await purge(container)

    expect(result).toMatchObject({ status: 'storage_unavailable', deleted: 0, failed: 0 })
    expect(service.delete).not.toHaveBeenCalled()
    expect(cursors.store.write).not.toHaveBeenCalled()

    const { container: restored, deletedKeys } = createContainer()
    await purge(restored)
    expect(deletedKeys).toHaveLength(2)
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

    const result = await purge(container)

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

    const result = await purge(container, SCOPE_A, { batchSize: 2 })

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

    await purge(container)

    expect(deletedKeys.map((entry) => entry.key)).toEqual([ownKey])
  })
})

describe('module config trace content retention cursor store', () => {
  function createConfigContainer(initial: Record<string, { value: unknown; source: string }> = {}) {
    const records = new Map(Object.entries(initial))
    const service = {
      getRecord: jest.fn(async (moduleId: string, name: string, scope?: { tenantId?: string | null }) =>
        records.get(`${moduleId}|${name}|${scope?.tenantId ?? ''}`) ?? null,
      ),
      setValue: jest.fn(
        async (moduleId: string, name: string, value: unknown, scope?: { tenantId?: string | null }) => {
          records.set(`${moduleId}|${name}|${scope?.tenantId ?? ''}`, { value, source: 'tenant' })
        },
      ),
    }
    const container = { resolve: (name: string) => (name === 'moduleConfigService' ? service : undefined) } as unknown as AwilixContainer
    return { container, service }
  }

  it('stores one tenant-scoped cursor per organization and row family', async () => {
    const { container, service } = createConfigContainer()
    const store = createModuleConfigTraceContentRetentionCursorStore(container)
    const position = { createdAt: new Date('2026-09-01T00:00:00.123Z'), rowId: '00000000-0000-4000-8000-000000000001' }

    expect(await store.read(SCOPE_A, 'llm_span')).toBeNull()
    await store.write(SCOPE_A, 'llm_span', position)

    expect(service.setValue).toHaveBeenCalledWith(
      'agent_orchestrator',
      'trace_content_retention_cursor:org-A:llm_span',
      { createdAt: '2026-09-01T00:00:00.123Z', rowId: position.rowId },
      { tenantId: 'tenant-A', organizationId: 'org-A' },
    )
    expect(await store.read(SCOPE_A, 'llm_span')).toEqual(position)
    expect(await store.read(SCOPE_A, 'context_bundle')).toBeNull()
    expect(await store.read(SCOPE_B, 'llm_span')).toBeNull()
  })

  it('ignores an instance-level or malformed cursor value', async () => {
    const { container } = createConfigContainer({
      'agent_orchestrator|trace_content_retention_cursor:org-A:llm_span|tenant-A': {
        value: { createdAt: '2026-09-01T00:00:00.000Z', rowId: 'row-1' },
        source: 'instance',
      },
      'agent_orchestrator|trace_content_retention_cursor:org-A:context_bundle|tenant-A': {
        value: { createdAt: 'not a date', rowId: 'row-2' },
        source: 'tenant',
      },
    })
    const store = createModuleConfigTraceContentRetentionCursorStore(container)

    expect(await store.read(SCOPE_A, 'llm_span')).toBeNull()
    expect(await store.read(SCOPE_A, 'context_bundle')).toBeNull()
  })

  it('fails loudly when the module config service is missing', async () => {
    const container = { resolve: () => undefined } as unknown as AwilixContainer
    const store = createModuleConfigTraceContentRetentionCursorStore(container)

    await expect(store.read(SCOPE_A, 'llm_span')).rejects.toThrow('moduleConfigService unavailable')
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
