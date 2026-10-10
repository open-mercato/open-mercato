import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import cliCommands from '../cli'
import { applyBrevoEnvPreset, readBrevoEnvPreset } from '../lib/preset'

const mockInfo = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: (...args: unknown[]) => mockInfo(...args) }) }),
}))

jest.mock('../lib/preset', () => ({
  applyBrevoEnvPreset: jest.fn(),
  readBrevoEnvPreset: jest.fn(),
}))

const mockCreateRequestContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockApplyBrevoEnvPreset = applyBrevoEnvPreset as jest.MockedFunction<typeof applyBrevoEnvPreset>
const mockReadBrevoEnvPreset = readBrevoEnvPreset as jest.MockedFunction<typeof readBrevoEnvPreset>

describe('channel_brevo configure-from-env CLI', () => {
  const originalEnv = process.env
  const dispose = jest.fn().mockResolvedValue(undefined)
  const em = { id: 'entity-manager' }

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SYSTEM_EMAIL_PROVIDER: 'brevo',
      OM_INTEGRATION_BREVO_API_KEY: 'brevo-secret-value',
    }
    dispose.mockClear()
    mockInfo.mockClear()
    mockApplyBrevoEnvPreset.mockReset().mockResolvedValue(undefined)
    mockReadBrevoEnvPreset.mockReset().mockReturnValue({
      apiKey: 'brevo-secret-value',
      fromAddress: 'from@example.com',
    })
    mockCreateRequestContainer.mockReset().mockResolvedValue({
      resolve: () => em,
      dispose,
    } as never)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('is rerunnable with the same scope and never logs credential values', async () => {
    const command = cliCommands.find((entry) => entry.command === 'configure-from-env')
    expect(command).toBeDefined()

    await command?.run(['--tenant', 'tenant-1', '--org', 'organization-1'])
    await command?.run(['--tenant=tenant-1', '--org=organization-1'])

    expect(mockApplyBrevoEnvPreset).toHaveBeenCalledTimes(2)
    expect(mockApplyBrevoEnvPreset).toHaveBeenNthCalledWith(1, {
      em,
      container: expect.any(Object),
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
    expect(mockApplyBrevoEnvPreset).toHaveBeenNthCalledWith(2, {
      em,
      container: expect.any(Object),
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('brevo-secret-value')
  })
})
