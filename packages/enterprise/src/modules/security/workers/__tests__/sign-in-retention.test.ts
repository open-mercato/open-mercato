import handle from '../sign-in-retention'

const mockExecute = jest.fn()
const mockTransactionExecute = jest.fn()
const mockManager = {
  execute: mockExecute,
  fork: () => mockManager,
  transactional: (work: (transaction: { execute: typeof mockTransactionExecute }) => Promise<void>) =>
    work({ execute: mockTransactionExecute }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => mockManager }),
}))

test('deletes in batches and rechecks device expiry while holding the device lock', async () => {
  mockExecute
    .mockResolvedValueOnce(Array.from({ length: 5000 }, () => ({ id: 'expired' })))
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: 'device', tenant_id: 'tenant', user_id: 'user' }])

  await handle({ id: 'job', payload: {}, createdAt: new Date().toISOString() })

  const [cutoff, batchSize] = mockExecute.mock.calls[0][1]
  expect(cutoff).toBeInstanceOf(Date)
  expect(batchSize).toBe(5000)
  expect(mockExecute.mock.calls[0]).toEqual(mockExecute.mock.calls[1])
  expect(mockExecute.mock.calls[3][0]).toContain("status <> 'pending'")
  expect(mockTransactionExecute).toHaveBeenNthCalledWith(
    1, expect.stringContaining('pg_advisory_xact_lock'), ['security:sign-in:device:tenant:user'],
  )
  expect(mockTransactionExecute).toHaveBeenNthCalledWith(
    2, expect.stringContaining("intent.status = 'pending'"), ['device', 'tenant', 'user', cutoff],
  )
})
