import { setup } from '../setup'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('../lib/preset', () => ({
  applyShopifyEnvPreset: jest.fn(async () => {
    throw new Error('preset boom with clientSecret=should-not-leak')
  }),
}))

describe('sync_shopify setup', () => {
  beforeEach(() => {
    reportError.mockClear()
  })

  it('reports preset failures with a stable fingerprint and scoped attributes', async () => {
    const container = {
      resolve: (key: string) => {
        if (key === 'integrationCredentialsService') return {}
        if (key === 'integrationStateService') return {}
        if (key === 'integrationLogService') return {}
        throw new Error(`unexpected resolve: ${key}`)
      },
    }

    await setup.seedDefaults?.({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      container: container as never,
    })

    expect(reportError).toHaveBeenCalledTimes(1)
    const [error, context] = reportError.mock.calls[0] ?? []
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain('preset boom')
    expect(context).toEqual({
      module: 'sync_shopify',
      code: 'sync_shopify.preset_failed',
      attributes: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    })
    expect(JSON.stringify(context)).not.toContain('should-not-leak')
  })
})
