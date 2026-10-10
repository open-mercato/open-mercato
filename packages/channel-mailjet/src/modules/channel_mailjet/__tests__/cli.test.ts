import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import cliCommands from '../cli'
import { applyMailjetEnvPreset, readMailjetEnvPreset } from '../lib/preset'

const mockInfo = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: (...args: unknown[]) => mockInfo(...args) }) }),
}))

jest.mock('../lib/preset', () => ({
  applyMailjetEnvPreset: jest.fn(),
  readMailjetEnvPreset: jest.fn(),
}))

const mockCreateRequestContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockApplyMailjetEnvPreset = applyMailjetEnvPreset as jest.MockedFunction<typeof applyMailjetEnvPreset>
const mockReadMailjetEnvPreset = readMailjetEnvPreset as jest.MockedFunction<typeof readMailjetEnvPreset>

describe('channel_mailjet configure-from-env CLI', () => {
  const originalEnv = process.env
  const dispose = jest.fn().mockResolvedValue(undefined)
  const em = { id: 'entity-manager' }

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SYSTEM_EMAIL_PROVIDER: 'mailjet',
      OM_INTEGRATION_MAILJET_API_KEY: 'mailjet-public-value',
      OM_INTEGRATION_MAILJET_SECRET_KEY: 'mailjet-secret-value',
    }
    dispose.mockClear()
    mockInfo.mockClear()
    mockApplyMailjetEnvPreset.mockReset().mockResolvedValue(undefined)
    mockReadMailjetEnvPreset.mockReset().mockReturnValue({
      apiKey: 'mailjet-public-value',
      secretKey: 'mailjet-secret-value',
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

    expect(mockApplyMailjetEnvPreset).toHaveBeenCalledTimes(2)
    expect(mockApplyMailjetEnvPreset).toHaveBeenNthCalledWith(1, {
      em,
      container: expect.any(Object),
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
    expect(mockApplyMailjetEnvPreset).toHaveBeenNthCalledWith(2, {
      em,
      container: expect.any(Object),
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
    expect(dispose).toHaveBeenCalledTimes(2)
    const logs = JSON.stringify(mockInfo.mock.calls)
    expect(logs).not.toContain('mailjet-public-value')
    expect(logs).not.toContain('mailjet-secret-value')
  })
})
