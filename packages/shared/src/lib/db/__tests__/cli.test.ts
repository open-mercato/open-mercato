import { runDatabaseCliCommand } from '../cli'
import { validateDeclaredDatabaseBinding } from '../declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '../runtime'

jest.mock('../declarations', () => ({ validateDeclaredDatabaseBinding: jest.fn(async () => true) }))
jest.mock('../runtime', () => ({
  isDatabaseRuntimeEnabled: jest.fn(() => true),
  runWithFreshDatabaseExecutionContext: jest.fn((_context, callback) => callback()),
}))
const enabled = jest.mocked(isDatabaseRuntimeEnabled)
const boundary = jest.mocked(runWithFreshDatabaseExecutionContext)
const binding = jest.mocked(validateDeclaredDatabaseBinding)
const tenant = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { jest.clearAllMocks(); enabled.mockReturnValue(true); binding.mockResolvedValue(true) })

it('preserves legacy arguments without activating any boundary', async () => {
  enabled.mockReturnValue(false)
  const run = jest.fn()
  await runDatabaseCliCommand({ command: 'fixture', run }, ['--tenant', 'legacy'], 'fixture')
  expect(run).toHaveBeenCalledWith(['--tenant', 'legacy'])
  expect(boundary).not.toHaveBeenCalled()
})
it('validates canonical tenant before entering a restricted invocation', async () => {
  const run = jest.fn()
  await runDatabaseCliCommand({ command: 'fixture', databaseAccess: 'tenant-or-maintenance', run }, [`--tenant=${tenant}`], 'fixture')
  expect(binding).toHaveBeenCalledWith({ context: { kind: 'tenant', tenantId: tenant, source: 'cli', operation: 'fixture' } }, { requireValidator: true })
  expect(boundary).toHaveBeenLastCalledWith({ kind: 'tenant', tenantId: tenant, source: 'cli', operation: 'fixture' }, expect.any(Function))
  expect(run).toHaveBeenCalledTimes(1)
})
it('never upgrades absent tenant to maintenance without owner capability', async () => {
  const run = jest.fn()
  await runDatabaseCliCommand({ command: 'fixture', run }, [], 'fixture')
  expect(boundary).toHaveBeenCalledWith({ kind: 'identity', tenantId: null, source: 'identity', operation: 'fixture' }, expect.any(Function))
  await runDatabaseCliCommand({ command: 'fixture', databaseAccess: 'tenant-or-maintenance', run }, [], 'fixture')
  expect(boundary).toHaveBeenLastCalledWith({ kind: 'maintenance', tenantId: null, source: 'cli', operation: 'fixture' }, expect.any(Function))
})
it('rejects missing, conflicting, malformed and inactive tenant bindings before side effects', async () => {
  const command = { command: 'fixture', run: jest.fn() }
  for (const args of [['--tenant'], ['--tenant=invalid'], [`--tenant=${tenant}`, '--tenantId=22222222-2222-4222-8222-222222222222']]) {
    await expect(runDatabaseCliCommand(command, args, 'fixture')).rejects.toThrow()
  }
  binding.mockResolvedValue(false)
  await expect(runDatabaseCliCommand(command, [`--tenant=${tenant}`], 'fixture')).rejects.toThrow('binding')
  expect(command.run).not.toHaveBeenCalled()
})
