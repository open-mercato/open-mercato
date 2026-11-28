import cli from '../cli'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/audit_logs/services/actionLogService', () => ({
  ActionLogService: jest.fn(),
}))

describe('audit_logs projections:backfill CLI options', () => {
  const backfillProjections = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    backfillProjections.mockResolvedValue({ scanned: 0, updated: 0, skipped: 0, errors: 0 })
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: () => ({ backfillProjections }),
    } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  })

  afterEach(() => jest.restoreAllMocks())

  it('passes full equals-containing inline values to the service', async () => {
    await cli[0].run(['ignored', '--tenant=tenant=a=b', '--org=org=c=d', '--batch=17', '--force'])

    expect(backfillProjections).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant=a=b', organizationId: 'org=c=d', batchSize: 17, force: true,
    }))
  })

  it('preserves empty inline values, space-separated values and explicit false', async () => {
    await cli[0].run(['--tenant=', '--org', 'org=a=b', '--force=false'])

    expect(backfillProjections).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '', organizationId: 'org=a=b', batchSize: 250, force: false,
    }))
  })
})
