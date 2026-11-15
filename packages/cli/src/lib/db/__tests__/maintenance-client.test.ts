import { createCliMaintenanceClient } from '../maintenance-client'
import { configureDatabasePool, isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const query = jest.fn(async () => ({ rows: [] }))
const end = jest.fn(async () => undefined)
const ready = jest.fn(async () => undefined)
const dispose = jest.fn()
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query, end })),
  Client: jest.fn(() => ({ legacy: true })),
}))
jest.mock('@open-mercato/shared/lib/db/ssl', () => ({ getSslConfig: () => undefined }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: jest.fn(() => true),
  resolveDatabaseConnectionUrl: jest.fn(() => 'private-maintenance-connection'),
  configureDatabasePool: jest.fn(() => ({ ready, dispose })),
  runWithFreshDatabaseExecutionContext: jest.fn((_context, callback) => callback()),
}))
beforeEach(() => { jest.clearAllMocks(); jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(true); ready.mockResolvedValue(undefined) })
it('routes readiness and SQL through explicit maintenance scopes and drains registration', async () => {
  const client = await createCliMaintenanceClient('private-runtime-connection')
  await client.connect()
  await client.query('SELECT 1')
  await client.end()
  expect(configureDatabasePool).toHaveBeenCalledWith(expect.any(Object), { id: 'cli.maintenance', purpose: 'maintenance', tables: [] })
  expect(runWithFreshDatabaseExecutionContext).toHaveBeenCalledTimes(2)
  expect(runWithFreshDatabaseExecutionContext).toHaveBeenLastCalledWith({ kind: 'maintenance', tenantId: null, source: 'cli', operation: 'database-maintenance' }, expect.any(Function))
  expect(query).toHaveBeenCalledWith('SELECT 1')
  expect(end).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
})
it('rejects SQL when physical role verification fails', async () => {
  ready.mockRejectedValueOnce(new Error('wrong role'))
  const client = await createCliMaintenanceClient('private-runtime-connection')
  await expect(client.query('SELECT 1')).rejects.toThrow('wrong role')
  expect(query).not.toHaveBeenCalled()
  await client.end()
})
it('preserves the legacy client and closes pools after registration rejection', async () => {
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(false)
  expect(await createCliMaintenanceClient(undefined)).toEqual({ legacy: true })
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(true)
  jest.mocked(configureDatabasePool).mockImplementationOnce(() => { throw new Error('registration rejected') })
  await expect(createCliMaintenanceClient('private-runtime-connection')).rejects.toThrow('registration rejected')
  expect(end).toHaveBeenCalledTimes(1)
})
