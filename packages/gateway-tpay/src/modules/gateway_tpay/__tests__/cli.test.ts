const mockReportError = jest.fn()
const mockReadPreset = jest.fn()
const mockApplyPreset = jest.fn()
const mockRegister = jest.fn()
const mockDispose = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    hasRegistration: (name: string) => name === 'schedulerService',
    resolve: (name: string) => (name === 'schedulerService' ? { register: mockRegister } : {}),
    dispose: mockDispose,
  }),
}))
jest.mock('../lib/preset', () => ({
  readTpayEnvPreset: (...args: unknown[]) => mockReadPreset(...args),
  applyTpayEnvPreset: (...args: unknown[]) => mockApplyPreset(...args),
}))

import cli from '../cli'
import { tpayReconciliationScheduleId } from '../lib/reconciliation-schedule'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '11111111-1111-4111-8111-111111111111'
const SECRET = 'client-secret-value'

const configureFromEnv = cli.find((command) => command.command === 'configure-from-env')

function runConfigure(): Promise<void> {
  if (!configureFromEnv) throw new Error('[internal] configure-from-env command missing')
  return configureFromEnv.run(['--tenant', TENANT, '--org', ORG])
}

describe('gateway_tpay configure-from-env', () => {
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    mockReadPreset.mockResolvedValue({ clientId: 'id', clientSecret: SECRET })
    mockRegister.mockResolvedValue(undefined)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = undefined
  })

  it.each([true, false])('syncs the reconciliation schedule after configuring (enabled=%s)', async (enabled) => {
    mockApplyPreset.mockResolvedValue({ status: 'configured', appliedApiVersion: 'v1', enabled })
    await runConfigure()
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        id: tpayReconciliationScheduleId({ tenantId: TENANT, organizationId: ORG }),
        tenantId: TENANT,
        organizationId: ORG,
        isEnabled: enabled,
      }),
    )
    expect(process.exitCode).toBeUndefined()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('does not touch the schedule when the preset is skipped', async () => {
    mockApplyPreset.mockResolvedValue({ status: 'skipped', reason: 'already configured' })
    await runConfigure()
    expect(mockRegister).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it('reports schedule failures and exits with code 1 without printing secrets', async () => {
    mockApplyPreset.mockResolvedValue({ status: 'configured', appliedApiVersion: null, enabled: true })
    mockRegister.mockRejectedValue(new Error('scheduler down'))
    await runConfigure()
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'gateway_tpay',
      code: 'gateway_tpay.reconciliation_schedule_failed',
    })
    expect(process.exitCode).toBe(1)
    const printed = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join('\n')
    expect(printed).toContain('scheduler down')
    expect(printed).not.toContain(SECRET)
    expect(mockDispose).toHaveBeenCalled()
  })
})
