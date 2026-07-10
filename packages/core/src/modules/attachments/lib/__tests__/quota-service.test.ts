/** @jest-environment node */

const mockAdvisoryLockExecute = jest.fn(async () => undefined)
const reconcileInsertValues: unknown[][] = []

jest.mock('kysely', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    as: (alias: string) => ({ alias }),
    execute: async () => {
      const statement = Array.isArray(strings) ? strings.join('?') : String(strings)
      if (statement.includes('insert into attachment_quota_reservations')) {
        reconcileInsertValues.push(values)
        return undefined
      }
      return mockAdvisoryLockExecute()
    },
  }),
}))

jest.mock('../upload-limits', () => ({
  resolveAttachmentTenantQuotaBytes: () => 3,
}))

import { AttachmentQuotaError, AttachmentQuotaService } from '../quota-service'

type ReservationRow = {
  reservedBytes: number
  actualBytes: number | null
  status: string
}

const RECONCILE_INSERT_PATH_INDEX = 6

function reconciledPaths(): string[] {
  return reconcileInsertValues.map((values) => String(values[RECONCILE_INSERT_PATH_INDEX]))
}

function createSerializedEntityManager(options: {
  attachmentPaths?: string[]
  ledgerRows?: Array<{ storage_path: string; status: string }>
} = {}) {
  const reservations: ReservationRow[] = []
  const deletedLedgerPaths: string[] = []
  let transactionTail = Promise.resolve()

  const db = {
    selectFrom: (table: string) => {
      const query = {
        select: () => query,
        where: () => query,
        executeTakeFirst: async () => ({
          total_size: table === 'attachments'
            ? 0
            : reservations.reduce(
                (total, row) => total + (row.status === 'committed' ? (row.actualBytes ?? 0) : row.reservedBytes),
                0,
              ),
        }),
        execute: async () =>
          table === 'attachments'
            ? (options.attachmentPaths ?? []).map((path) => ({ storage_path: path }))
            : (options.ledgerRows ?? []),
      }
      return query
    },
    deleteFrom: () => {
      const query = {
        where: (column: string, _operator: string, value: unknown) => {
          if (column === 'storage_path') deletedLedgerPaths.push(...(value as string[]))
          return query
        },
        execute: async () => undefined,
      }
      return query
    },
  }

  const tx = {
    getKysely: () => db,
    create: (_entity: unknown, input: ReservationRow) => input,
    persist: (row: ReservationRow) => ({
      flush: async () => {
        reservations.push(row)
      },
    }),
  }

  const em = {
    getKysely: () => db,
    transactional: <T>(work: (manager: typeof tx) => Promise<T>): Promise<T> => {
      const result = transactionTail.then(() => work(tx))
      transactionTail = result.then(() => undefined, () => undefined)
      return result
    },
  }

  return { em, reservations, deletedLedgerPaths }
}

describe('AttachmentQuotaService', () => {
  beforeEach(() => {
    mockAdvisoryLockExecute.mockClear()
    reconcileInsertValues.length = 0
  })

  it('serializes real reserve calls so concurrent admission cannot exceed quota', async () => {
    const { em, reservations } = createSerializedEntityManager()
    const service = new AttachmentQuotaService(em as never)

    const attempts = await Promise.allSettled([
      service.reserve({
        tenantId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        bytes: 3,
        source: 'attachment',
        storageDriver: 'local',
        storagePath: 'one.pdf',
      }),
      service.reserve({
        tenantId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        bytes: 3,
        source: 'attachment',
        storageDriver: 'local',
        storagePath: 'two.pdf',
      }),
    ])

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(AttachmentQuotaError)
    expect(rejected.reason.code).toBe('quota_exceeded')
    expect(reservations).toHaveLength(1)
    expect(mockAdvisoryLockExecute).toHaveBeenCalledTimes(2)
  })

  it('keeps zero-byte uploads backward compatible', async () => {
    const { em, reservations } = createSerializedEntityManager()
    const service = new AttachmentQuotaService(em as never)

    await expect(service.reserve({
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      bytes: 0,
      source: 'attachment',
      storageDriver: 'local',
      storagePath: 'empty.txt',
    })).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }))
    expect(reservations[0]?.reservedBytes).toBe(0)
  })

  it('does not reconcile attachment-backed S3 objects into standalone usage', async () => {
    const { em } = createSerializedEntityManager({ attachmentPaths: ['attachment.pdf'] })
    const service = new AttachmentQuotaService(em as never)

    await service.reconcileStandaloneObjects({
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      storageDriver: 's3',
      objects: [
        { path: 'attachment.pdf', bytes: 2 },
        { path: 'uploads/standalone.pdf', bytes: 1 },
      ],
    })

    expect(reconciledPaths()).toEqual(['uploads/standalone.pdf'])
  })

  it('skips already-reconciled objects instead of re-inserting them on every admission', async () => {
    const { em, deletedLedgerPaths } = createSerializedEntityManager({
      ledgerRows: [{ storage_path: 'uploads/existing.pdf', status: 'committed' }],
    })
    const service = new AttachmentQuotaService(em as never)

    await service.reconcileStandaloneObjects({
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      storageDriver: 's3',
      objects: [
        { path: 'uploads/existing.pdf', bytes: 2 },
        { path: 'uploads/new.pdf', bytes: 1 },
      ],
    })

    expect(reconciledPaths()).toEqual(['uploads/new.pdf'])
    expect(deletedLedgerPaths).toEqual([])
  })

  it('heals committed ledger rows whose path gained an authoritative attachment row', async () => {
    const { em, deletedLedgerPaths } = createSerializedEntityManager({
      attachmentPaths: ['double-counted.pdf'],
      ledgerRows: [{ storage_path: 'double-counted.pdf', status: 'committed' }],
    })
    const service = new AttachmentQuotaService(em as never)

    await service.reconcileStandaloneObjects({
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      storageDriver: 's3',
      objects: [{ path: 'double-counted.pdf', bytes: 2 }],
    })

    expect(deletedLedgerPaths).toEqual(['double-counted.pdf'])
    expect(reconciledPaths()).toEqual([])
  })
})
