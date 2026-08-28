const enqueue = jest.fn(async () => undefined)

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue })),
}))

import handle from '../access-log-retention'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function makeContext(applyRetention: jest.Mock) {
  return {
    resolve: (name: string) => {
      if (name === 'accessLogService') return { applyRetention }
      throw new Error(`Unexpected service ${name}`)
    },
  }
}

describe('access-log retention worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('runs a tenant-scoped batch and schedules continuation after a full batch', async () => {
    const applyRetention = jest.fn(async () => ({
      accessClass: 'core',
      batchSize: 2,
      cutoff: new Date('2026-05-01T00:00:00.000Z'),
      deleted: 2,
      dryRun: false,
      matched: 2,
      retentionDays: 90,
    }))
    const payload = { accessClass: 'core' as const, batchSize: 2, organizationId, retentionDays: 90, tenantId }

    await handle({ payload } as never, makeContext(applyRetention) as never)

    expect(applyRetention).toHaveBeenCalledWith(expect.objectContaining({
      accessClass: 'core',
      batchSize: 2,
      organizationId,
      tenantId,
    }))
    expect(enqueue).toHaveBeenCalledWith(payload, { delayMs: 1000 })
  })

  it('never schedules continuation for dry-run', async () => {
    const applyRetention = jest.fn(async () => ({
      accessClass: 'all',
      batchSize: 1000,
      cutoff: new Date('2026-05-01T00:00:00.000Z'),
      deleted: 0,
      dryRun: true,
      matched: 20_000,
      retentionDays: 90,
    }))

    await handle({
      payload: { dryRun: true, organizationId, tenantId },
    } as never, makeContext(applyRetention) as never)

    expect(enqueue).not.toHaveBeenCalled()
  })

  it('propagates validation failures from the retention service', async () => {
    const applyRetention = jest.fn(async () => {
      throw new Error('tenantId is required')
    })

    await expect(handle({ payload: {} } as never, makeContext(applyRetention) as never))
      .rejects.toThrow('tenantId is required')
    expect(enqueue).not.toHaveBeenCalled()
  })
})
