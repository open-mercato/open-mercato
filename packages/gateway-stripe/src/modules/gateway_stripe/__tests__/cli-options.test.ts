import cli from '../cli'
import { applyStripeEnvPreset } from '../lib/preset'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: jest.fn(), dispose: jest.fn() }),
}))
jest.mock('../lib/preset', () => ({
  readStripeEnvPreset: () => ({}),
  applyStripeEnvPreset: jest.fn(),
}))

describe('gateway_stripe configure-from-env CLI options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.mocked(applyStripeEnvPreset).mockResolvedValue({
      status: 'skipped', reason: 'already-configured',
    } as Awaited<ReturnType<typeof applyStripeEnvPreset>>)
  })

  afterEach(() => jest.restoreAllMocks())

  it.each([
    [['--force'], true],
    [['--force=true'], false],
    [['--force', 'true'], false],
    [['--force='], false],
  ])('preserves the strict boolean force switch for %j', async (flags, force) => {
    await cli[0].run(['ignored', '--tenant=tenant=a=b', '--org', 'org=c=d', ...flags])

    expect(applyStripeEnvPreset).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: 'tenant=a=b', organizationId: 'org=c=d' }, force,
    }))
  })
})
