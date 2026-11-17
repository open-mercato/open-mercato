/** @jest-environment node */
import cli from '../cli'
import { installCustomEntitiesFromModules } from '../lib/install-from-ce'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}) }),
}))
jest.mock('../lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: jest.fn(async () => ({ processed: 0, synchronized: 0, fieldChanges: 0, skipped: 0 })),
}))

const installCommand = cli.find((entry) => entry.command === 'install')!

describe('entities CLI option values', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => jest.restoreAllMocks())

  it.each(['left=right', 'encoded==', '=leading'])('preserves tenant value %j', async (value) => {
    await installCommand.run([`--tenant=${value}`])

    expect(installCustomEntitiesFromModules).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ tenantIds: [value] }),
    )
  })

  it('does not consume the following flag for an empty value', async () => {
    await installCommand.run(['--tenant=', '--tenantId=fallback', '--dry-run'])

    expect(installCustomEntitiesFromModules).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ tenantIds: ['fallback'], dryRun: true }),
    )
  })

  it('keeps space-separated values, boolean flags and ignored positionals', async () => {
    await installCommand.run(['ignored', '--tenant', 'left=right', '--dry-run', '--no-global', '--force'])

    expect(installCustomEntitiesFromModules).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({
        tenantIds: ['left=right'], dryRun: true, includeGlobal: false, force: true,
      }),
    )
  })
})
