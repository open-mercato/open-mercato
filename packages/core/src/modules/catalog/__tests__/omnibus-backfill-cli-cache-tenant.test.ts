import { getCurrentCacheTenant } from '@open-mercato/cache'

const runOmnibusBackfillMock = jest.fn()

jest.mock('../lib/omnibusBackfill', () => ({
  runOmnibusBackfill: (...args: unknown[]) => runOmnibusBackfillMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => null })),
}))

import catalogCli from '../cli'

const TENANT = '22222222-2222-4222-8222-222222222222'

describe('omnibus:backfill CLI cache tenant', () => {
  it('runs the backfill in the tenant cache namespace that admin config writes invalidate', async () => {
    let seenTenant: string | null = 'unset'
    runOmnibusBackfillMock.mockImplementation(async () => {
      seenTenant = getCurrentCacheTenant()
      return {
        tenantId: TENANT,
        organizationId: null,
        targets: [],
        coverageRecorded: [],
        dryRun: false,
      }
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const command = catalogCli.find((entry) => entry.command === 'omnibus:backfill')
    expect(command).toBeDefined()

    await command?.run(['--tenant', TENANT])

    expect(runOmnibusBackfillMock).toHaveBeenCalledTimes(1)
    expect(seenTenant).toBe(TENANT)
    logSpy.mockRestore()
  })
})
