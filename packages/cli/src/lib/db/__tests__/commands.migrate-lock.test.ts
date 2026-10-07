import type { PackageResolver } from '../../resolver'

const withUpgradeLock = jest.fn(
  async (action: (client: unknown) => Promise<unknown>) => action(null),
)

jest.mock('../../upgrade-lock', () => ({
  withUpgradeLock: (...args: any[]) => withUpgradeLock(...(args as [any, any])),
}))

// No modules, so the migration body is a no-op and the only thing under test is whether the lock
// was taken.
function createEmptyResolver(): PackageResolver {
  return {
    isMonorepo: () => true,
    getRootDir: () => '/tmp/test-root',
    getAppDir: () => '/tmp/test-app',
    getOutputDir: () => '/tmp/test-out',
    getModulesConfigPath: () => '/tmp/test-root/modules.ts',
    discoverPackages: () => [],
    loadEnabledModules: () => [],
    getModulePaths: () => ({ appBase: '/nonexistent', pkgBase: '/nonexistent' }),
    getModuleImportBase: () => ({ appBase: '@/modules/x', pkgBase: '@open-mercato/core/modules/x' }),
    getPackageOutputDir: () => '/tmp/test-out',
    getPackageRoot: () => '/tmp/test-root',
  } as unknown as PackageResolver
}

describe('db:migrate lock adoption', () => {
  beforeEach(() => {
    withUpgradeLock.mockClear()
  })

  // Locking only `upgrade` would leave the race open through every door the spec names: a manual
  // migrate Job, an orphaned one, or a `MIGRATE_COMMAND` override. The public path must participate.
  it('acquires the upgrade lock on the public entry point', async () => {
    const { dbMigrate } = await import('../commands')
    await dbMigrate(createEmptyResolver())
    expect(withUpgradeLock).toHaveBeenCalledTimes(1)
  })

  it('forwards --no-lock and --lock-timeout to the lock', async () => {
    const { dbMigrate } = await import('../commands')
    await dbMigrate(createEmptyResolver(), { noLock: true, lockTimeoutSeconds: 42 })

    const options = withUpgradeLock.mock.calls[0]?.[1] as
      | { skip?: boolean; timeoutSeconds?: number }
      | undefined
    expect(options?.skip).toBe(true)
    expect(options?.timeoutSeconds).toBe(42)
  })

  // `upgrade` calls this while already holding the lock on its own dedicated connection. A nested
  // acquisition would run on a different session and wait forever on a holder that is itself
  // blocked in application code — a deadlock Postgres cannot detect.
  it('never acquires the lock in the internal primitive', async () => {
    const { dbMigrateUnlocked } = await import('../commands')
    await dbMigrateUnlocked(createEmptyResolver())
    expect(withUpgradeLock).not.toHaveBeenCalled()
  })
})
