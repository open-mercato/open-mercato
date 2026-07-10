/** @jest-environment node */

const mockAdvisoryLockExecute = jest.fn(async () => undefined)

jest.mock('kysely', () => ({
  sql: () => ({
    as: (alias: string) => ({ alias }),
    execute: mockAdvisoryLockExecute,
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

function createSerializedEntityManager() {
  const reservations: ReservationRow[] = []
  const reconciledPaths: string[] = []
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
        execute: async () => table === 'attachments' ? [{ storage_path: 'attachment.pdf' }] : [],
      }
      return query
    },
    insertInto: () => {
      let values: { storage_path: string } | null = null
      const query = {
        values: (input: { storage_path: string }) => {
          values = input
          return query
        },
        onConflict: (configure: (conflict: { columns: () => { doNothing: () => void } }) => unknown) => {
          configure({ columns: () => ({ doNothing: () => undefined }) })
          return query
        },
        execute: async () => {
          if (values) reconciledPaths.push(values.storage_path)
        },
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

  return { em, reservations, reconciledPaths }
}

describe('AttachmentQuotaService', () => {
  beforeEach(() => {
    mockAdvisoryLockExecute.mockClear()
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
    const { em, reconciledPaths } = createSerializedEntityManager()
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

    expect(reconciledPaths).toEqual(['uploads/standalone.pdf'])
  })
})
