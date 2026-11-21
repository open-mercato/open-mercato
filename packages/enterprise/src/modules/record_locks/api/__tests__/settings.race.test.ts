import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import { POST } from '@open-mercato/enterprise/modules/record_locks/api/settings/route'
import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'
import { RecordLockService } from '@open-mercato/enterprise/modules/record_locks/lib/recordLockService'

jest.mock('@open-mercato/enterprise/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

const TENANT_ID = '60000000-0000-4000-8000-000000000001'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const INSTANCE_AT = new Date('2026-11-20T09:00:00.000Z')
const TENANT_AT = new Date('2026-11-20T10:00:00.000Z')

const BASE_SETTINGS = {
  enabled: true,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  enabledResources: ['sales.quote'],
  allowForceUnlock: true,
  allowIncomingOverride: true,
  notifyOnConflict: true,
}

type StoredRow = {
  moduleId: string
  name: string
  tenantId: string | null
  organizationId: string | null
  valueJson: unknown
  createdAt: Date
  updatedAt: Date
}

const yieldToOtherRequests = () => new Promise<void>((resolve) => setImmediate(resolve))

function createDatabase(rows: StoredRow[]) {
  const table: StoredRow[] = rows.map((row) => ({ ...row }))
  const advisoryLocks = new Map<string, Promise<void>>()
  let clock = Date.parse('2026-11-20T11:00:00.000Z')

  const matches = (row: StoredRow, where: Partial<StoredRow>) =>
    row.moduleId === where.moduleId && row.name === where.name && row.tenantId === (where.tenantId ?? null)

  const transactional = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const releases: Array<() => void> = []
    const tracked = new Map<StoredRow, StoredRow | null>()
    const tx = {
      execute: async (_query: string, params: string[]) => {
        const key = params[0]
        const previous = advisoryLocks.get(key) ?? Promise.resolve()
        let release!: () => void
        const held = new Promise<void>((resolve) => { release = resolve })
        advisoryLocks.set(key, previous.then(() => held))
        releases.push(release)
        await previous
        return []
      },
      findOne: async (_entity: typeof ModuleConfig, where: Partial<StoredRow>) => {
        await yieldToOtherRequests()
        const stored = table.find((row) => matches(row, where))
        if (!stored) return null
        const copy = { ...stored }
        tracked.set(copy, stored)
        return copy
      },
      create: (_entity: typeof ModuleConfig, data: StoredRow) => ({ ...data }),
      persist: (entity: StoredRow) => {
        tracked.set(entity, null)
      },
      flush: async () => {
        await yieldToOtherRequests()
        for (const [entity, stored] of tracked) {
          if (stored && JSON.stringify(stored) === JSON.stringify(entity)) continue
          clock += 1000
          entity.updatedAt = new Date(clock)
          if (stored) {
            Object.assign(stored, entity)
          } else {
            if (table.some((row) => matches(row, entity))) {
              throw new Error('duplicate key value violates unique constraint "module_configs_scoped_unique"')
            }
            table.push({ ...entity })
          }
        }
      },
    }
    try {
      return await work(tx)
    } finally {
      releases.forEach((release) => release())
    }
  }

  return { table, em: { transactional } }
}

function useService(rows: StoredRow[]) {
  const database = createDatabase(rows)
  const moduleConfigService = {
    getRecord: jest.fn(),
    getValue: jest.fn(),
    setValue: jest.fn(),
    restoreDefaults: jest.fn(),
    invalidate: jest.fn().mockResolvedValue(undefined),
  }
  const recordLockService = new RecordLockService({
    em: database.em as never,
    moduleConfigService,
  })
  jest.mocked(resolveRecordLocksApiContext).mockResolvedValue({
    auth: { tenantId: TENANT_ID },
    recordLockService,
  } as unknown as Awaited<ReturnType<typeof resolveRecordLocksApiContext>>)
  return { ...database, moduleConfigService }
}

function postSettings(body: Record<string, unknown>, expectedUpdatedAt: Date) {
  return POST(new Request('http://localhost/api/record_locks/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [LOCK_HEADER]: expectedUpdatedAt.toISOString() },
    body: JSON.stringify(body),
  }))
}

function settingsRow(tenantId: string | null, updatedAt: Date): StoredRow {
  return {
    moduleId: 'record_locks',
    name: 'settings',
    tenantId,
    organizationId: null,
    valueJson: BASE_SETTINGS,
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('record_locks settings POST under concurrent saves', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('exactly one of two racing saves with the same version succeeds on an existing tenant row', async () => {
    const { table, moduleConfigService } = useService([settingsRow(null, INSTANCE_AT), settingsRow(TENANT_ID, TENANT_AT)])

    const responses = await Promise.all([
      postSettings({ ...BASE_SETTINGS, timeoutSeconds: 801 }, TENANT_AT),
      postSettings({ ...BASE_SETTINGS, heartbeatSeconds: 101 }, TENANT_AT),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const winner = responses.find((response) => response.status === 200)!
    const loser = responses.find((response) => response.status === 409)!
    const winnerBody = await winner.json()
    const loserBody = await loser.json()
    expect(loserBody).toEqual(expect.objectContaining({
      code: 'optimistic_lock_conflict',
      expectedUpdatedAt: TENANT_AT.toISOString(),
      currentUpdatedAt: winnerBody.updatedAt,
    }))

    const tenantRows = table.filter((row) => row.tenantId === TENANT_ID)
    expect(tenantRows).toHaveLength(1)
    expect(tenantRows[0].valueJson).toEqual(winnerBody.settings)
    expect(tenantRows[0].updatedAt.toISOString()).toBe(winnerBody.updatedAt)
    expect(moduleConfigService.invalidate).toHaveBeenCalledTimes(1)
    expect(moduleConfigService.setValue).not.toHaveBeenCalled()
  })

  test('exactly one of two racing first saves from inherited instance settings succeeds', async () => {
    const { table } = useService([settingsRow(null, INSTANCE_AT)])

    const responses = await Promise.all([
      postSettings({ ...BASE_SETTINGS, timeoutSeconds: 802 }, INSTANCE_AT),
      postSettings({ ...BASE_SETTINGS, heartbeatSeconds: 102 }, INSTANCE_AT),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const winnerBody = await responses.find((response) => response.status === 200)!.json()
    const tenantRows = table.filter((row) => row.tenantId === TENANT_ID)
    expect(tenantRows).toHaveLength(1)
    expect(tenantRows[0].valueJson).toEqual(winnerBody.settings)
    const instanceRow = table.find((row) => row.tenantId === null)!
    expect(instanceRow.updatedAt).toEqual(INSTANCE_AT)
    expect(instanceRow.valueJson).toEqual(BASE_SETTINGS)
  })

  test('a save that sends the version returned by the previous save succeeds', async () => {
    useService([settingsRow(null, INSTANCE_AT)])

    const first = await postSettings({ ...BASE_SETTINGS, timeoutSeconds: 803 }, INSTANCE_AT)
    expect(first.status).toBe(200)
    const firstBody = await first.json()

    const second = await postSettings({ ...BASE_SETTINGS, heartbeatSeconds: 103 }, new Date(firstBody.updatedAt))
    expect(second.status).toBe(200)
  })
})
