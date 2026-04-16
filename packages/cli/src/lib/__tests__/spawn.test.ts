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

  it('wraps Windows cmd shims in a shell command', () => {
    const result = resolveSpawnCommand('mercato.cmd', ['generate', '--watch'], { platform: 'win32' })

    expect(result).toEqual({
      command: 'mercato.cmd generate --watch',
      args: [],
      spawnOptions: { shell: true },
    })
  })

  it('quotes Windows cmd arguments that need shell escaping', () => {
    const result = resolveSpawnCommand('npx.cmd', ['playwright', 'test', 'spec with spaces.ts', '--grep="foo bar"'], {
      platform: 'win32',
    })

    expect(result).toEqual({
      command: 'npx.cmd playwright test "spec with spaces.ts" "--grep=""foo bar"""',
      args: [],
      spawnOptions: { shell: true },
    })
  })
})
