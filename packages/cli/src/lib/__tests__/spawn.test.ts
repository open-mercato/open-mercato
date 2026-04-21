import { resolveSpawnCommand } from '../spawn'

describe('resolveSpawnCommand', () => {
  it('keeps non-Windows commands unchanged', () => {
    const result = resolveSpawnCommand('yarn', ['--version'], { platform: 'linux' })

    expect(result).toEqual({
      command: 'yarn',
      args: ['--version'],
      spawnOptions: {},
    })
  })

  it('wraps Windows cmd shims in an explicit cmd.exe invocation', () => {
    const result = resolveSpawnCommand('mercato.cmd', ['generate', '--watch'], { platform: 'win32' })

    expect(result).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'mercato.cmd generate --watch'],
      spawnOptions: { windowsVerbatimArguments: true },
    })
  })

  it('quotes Windows cmd arguments that need shell escaping', () => {
    const result = resolveSpawnCommand('npx.cmd', ['playwright', 'test', 'spec with spaces.ts', '--grep="foo bar"'], {
      platform: 'win32',
    })

    expect(result).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx.cmd playwright test "spec with spaces.ts" "--grep=""foo bar"""'],
      spawnOptions: { windowsVerbatimArguments: true },
    })
  })

  it('rejects unsafe Windows cmd arguments before shell handoff', () => {
    expect(() => resolveSpawnCommand('yarn.cmd', ['%PATH%'], { platform: 'win32' })).toThrow(
      'Windows command argument #1 contains unsupported characters',
    )
  })
})
