/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { MaintenanceNotActiveError } from '@open-mercato/shared/lib/maintenance/types'

const execute = jest.fn()
const find = jest.fn()
const encryptEntityPayload = jest.fn()
const acquireHold = jest.fn()
const release = jest.fn(async () => {})
const assertLive = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek: async () => ({ tenantId: 'tenant-1', key: 'k', fetchedAt: 0 }),
    encryptEntityPayload,
  })),
}))

const em = {
  getConnection: () => ({ execute }),
  getMetadata: () => ({ get: () => ({ tableName: 'users' }) }),
  find,
}

const coordinator = {
  getState: async () => ({ active: false }),
  enter: jest.fn(),
  acquireHold,
  exit: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => (name === 'maintenanceCoordinator' ? coordinator : em),
  }),
}))

describe('auth rotate-encryption-key under Enterprise maintenance', () => {
  const rotate = cli.find((command) => command.command === 'rotate-encryption-key')!
  let previousToggle: string | undefined
  let previousExitCode: typeof process.exitCode

  beforeEach(() => {
    jest.clearAllMocks()
    previousToggle = process.env.TENANT_DATA_ENCRYPTION
    previousExitCode = process.exitCode
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    find.mockImplementation(async (entity: unknown) => (entity === Organization ? [{ id: 'org-1', tenant: { id: 'tenant-1' } }] : []))
    execute.mockResolvedValue([{ id: 'user-1', email: 'plain@example.com', email_hash: null }])
    encryptEntityPayload.mockImplementation(async () => ({ email: 'enc', emailHash: 'h' }))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousToggle
    process.exitCode = previousExitCode
    jest.restoreAllMocks()
  })

  it('refuses with exit 7 and makes zero reads or writes when no window is active', async () => {
    acquireHold.mockRejectedValueOnce(new MaintenanceNotActiveError())
    await rotate.run([])
    expect(process.exitCode).toBe(7)
    expect(execute).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    expect(encryptEntityPayload).not.toHaveBeenCalled()
  })

  it('rotates inside the hold, checks liveness per scope, and releases the hold', async () => {
    acquireHold.mockResolvedValueOnce({ id: 'h', windowId: 'w', drainReport: {}, assertLive, release })
    await rotate.run([])
    expect(acquireHold).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'encryption.auth.rotate-encryption-key',
      forbidsBypass: true,
      requireDrained: true,
    }))
    expect(assertLive).toHaveBeenCalled()
    expect(encryptEntityPayload).toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
    expect(coordinator.exit).not.toHaveBeenCalled()
  })

  it('does not require a window for --dry-run', async () => {
    await rotate.run(['--dry-run'])
    expect(acquireHold).not.toHaveBeenCalled()
  })
})
