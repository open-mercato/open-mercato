// Step 6.5 — unit coverage for `workers/code-reservation-sweep.worker.ts`. The worker is a
// thin wrapper (same shape as `cart`'s own four sweeper workers, none of which carry their own
// test file — the sweep logic itself is tested at `services/__tests__/code-reservation-sweeper.test.ts`),
// so this only exercises the wrapper's own tenant-resolution and fork/delegate behavior.

jest.mock('../../services/code-reservation-sweeper', () => ({
  sweepExpiredCodeReservations: jest.fn(async () => ({ released: 0 })),
}))

import { sweepExpiredCodeReservations } from '../../services/code-reservation-sweeper'
import handle from '../code-reservation-sweep.worker'

const sweepMock = sweepExpiredCodeReservations as jest.MockedFunction<typeof sweepExpiredCodeReservations>

function makeCtx(forkedEm: unknown) {
  const em = { fork: jest.fn(() => forkedEm) }
  return { resolve: jest.fn((name: string) => (name === 'em' ? em : undefined)) } as any
}

beforeEach(() => sweepMock.mockClear())

describe('code-reservation-sweep worker', () => {
  it('forks the resolved em and delegates to sweepExpiredCodeReservations with the tenant from job.payload.scope.tenantId', async () => {
    const forkedEm = { marker: 'forked' }
    const ctx = makeCtx(forkedEm)

    await handle({ payload: { scope: { tenantId: 'tenant-1' } } } as any, ctx)

    expect(sweepMock).toHaveBeenCalledWith(forkedEm, { tenantId: 'tenant-1' })
  })

  it('falls back to the top-level job.payload.tenantId shape the scheduler also uses', async () => {
    const forkedEm = { marker: 'forked' }
    const ctx = makeCtx(forkedEm)

    await handle({ payload: { tenantId: 'tenant-2' } } as any, ctx)

    expect(sweepMock).toHaveBeenCalledWith(forkedEm, { tenantId: 'tenant-2' })
  })

  it('skips the tick without calling the sweep when no tenantId is present', async () => {
    const ctx = makeCtx({})

    await handle({ payload: {} } as any, ctx)

    expect(sweepMock).not.toHaveBeenCalled()
  })

  it('rethrows when the sweep fails, so the queue can retry', async () => {
    sweepMock.mockRejectedValueOnce(new Error('boom'))
    const ctx = makeCtx({})

    await expect(handle({ payload: { tenantId: 'tenant-3' } } as any, ctx)).rejects.toThrow('boom')
  })
})
