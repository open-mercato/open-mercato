/** @jest-environment node */
import cli from '../cli'
import { setupInitialTenant } from '../lib/setup-app'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}) }),
}))
jest.mock('../lib/setup-app', () => ({
  setupInitialTenant: jest.fn(async () => ({ users: [], reusedExistingUser: false })),
}))

const setupCommand = cli.find((entry) => entry.command === 'setup')!

describe('auth CLI option values', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => jest.restoreAllMocks())

  it.each(['left=right', 'encoded==', '=leading'])('preserves orgName value %j', async (value) => {
    await setupCommand.run([
      `--orgName=${value}`, '--email=cli@example.com', '--password=example==', '--skip-password-policy',
    ])

    expect(setupInitialTenant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgName: value,
      primaryUser: { email: 'cli@example.com', password: 'example==', confirm: true },
    }))
  })

  it('keeps an empty value empty rather than treating it as a flag', async () => {
    const previousExitCode = process.exitCode
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await setupCommand.run(['--orgName=', '--email=cli@example.com', '--password=example'])
      expect(setupInitialTenant).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(2)
    } finally {
      process.exitCode = previousExitCode
      stderr.mockRestore()
    }
  })

  it('keeps space-separated values, boolean flags and ignored positionals', async () => {
    await setupCommand.run([
      'ignored', '--orgName', 'left=right', '--email', 'cli@example.com',
      '--password', 'example==', '--skip-password-policy', '--include-demo-users',
    ])

    expect(setupInitialTenant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgName: 'left=right', includeDerivedUsers: true,
      primaryUser: { email: 'cli@example.com', password: 'example==', confirm: true },
    }))
  })
})
