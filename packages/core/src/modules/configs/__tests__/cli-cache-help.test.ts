/** @jest-environment node */
jest.mock('../lib/cache-cli', () => ({
  collectCacheStats: jest.fn(),
  executeCachePurge: jest.fn(),
  previewCachePurge: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => {
    throw new Error('container-reached')
  }),
}))

import cli, { isCacheHelpFlag } from '@open-mercato/core/modules/configs/cli'

const cacheCli = jest.requireMock('../lib/cache-cli') as {
  collectCacheStats: jest.Mock
  executeCachePurge: jest.Mock
  previewCachePurge: jest.Mock
}

const cacheCommand = cli.find((command) => command.command === 'cache')!

describe('mercato configs cache --help never runs the subcommand (issue #5581)', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  const printed = () => logSpy.mock.calls.map((call) => String(call[0])).join('\n')

  it('opts out of the dispatcher intercept, so it owns the help guarantee itself', () => {
    expect(cacheCommand.handlesHelp).toBe(true)
  })

  it.each([
    ['purge', '--help'],
    ['purge', '-h'],
    ['purge', '--all', '--help'],
    ['structural', '--help'],
    ['stats', '--help'],
  ])('prints usage instead of running "cache %s %s"', async (...argv) => {
    await cacheCommand.run(argv)

    expect(printed()).toContain('🧹 Cache CLI')
    expect(cacheCli.executeCachePurge).not.toHaveBeenCalled()
    expect(cacheCli.previewCachePurge).not.toHaveBeenCalled()
    expect(cacheCli.collectCacheStats).not.toHaveBeenCalled()
  })

  it.each([[[]], [['help']], [['--help']], [['-h']]])(
    'still prints usage for the bare invocation %p',
    async (argv) => {
      await cacheCommand.run(argv)
      expect(printed()).toContain('🧹 Cache CLI')
    },
  )

  it('still runs a real purge when no help flag is present', async () => {
    await expect(cacheCommand.run(['purge', '--all'])).rejects.toThrow('container-reached')
    expect(printed()).not.toContain('🧹 Cache CLI')
  })

  it('does not treat arguments that merely contain the flag text as help', () => {
    expect(isCacheHelpFlag('--help')).toBe(true)
    expect(isCacheHelpFlag('-h')).toBe(true)
    expect(isCacheHelpFlag('help')).toBe(true)
    expect(isCacheHelpFlag('--help-me')).toBe(false)
    expect(isCacheHelpFlag('--no-help')).toBe(false)
    expect(isCacheHelpFlag('purge')).toBe(false)
  })
})
