/** @jest-environment node */
import { runSyncRequestSchema, runSyncSchema } from '../validators'

const base = {
  integrationId: 'sync_mixed',
  entityType: 'orders.backfill',
  direction: 'import' as const,
}

describe('runSyncSchema (deprecated bridge)', () => {
  it('still substitutes 100 for an omitted batch size', () => {
    expect(runSyncSchema.parse(base).batchSize).toBe(100)
  })

  it('keeps an explicit batch size and its bounds', () => {
    expect(runSyncSchema.parse({ ...base, batchSize: 500 }).batchSize).toBe(500)
    expect(runSyncSchema.safeParse({ ...base, batchSize: 1001 }).success).toBe(false)
  })
})

describe('runSyncRequestSchema', () => {
  it('leaves an omitted batch size absent so the adapter can answer', () => {
    expect(runSyncRequestSchema.parse(base).batchSize).toBeUndefined()
  })

  it('accepts the same explicit values and bounds as the bridge', () => {
    expect(runSyncRequestSchema.parse({ ...base, batchSize: 500 }).batchSize).toBe(500)
    expect(runSyncRequestSchema.safeParse({ ...base, batchSize: 0 }).success).toBe(false)
    expect(runSyncRequestSchema.safeParse({ ...base, batchSize: 1001 }).success).toBe(false)
  })

  it('accepts every request body the deprecated schema accepts', () => {
    const body = { ...base, fullSync: true, triggeredBy: 'operator', parameters: { startId: '7' } }
    expect(runSyncSchema.safeParse(body).success).toBe(true)
    expect(runSyncRequestSchema.safeParse(body).success).toBe(true)
  })
})
