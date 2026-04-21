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

  it('keeps Windows cmd shims as direct executable invocations for cross-spawn', () => {
    const result = resolveSpawnCommand('mercato.cmd', ['generate', '--watch'], { platform: 'win32' })

    expect(result).toEqual({
      command: 'mercato.cmd',
      args: ['generate', '--watch'],
      spawnOptions: {},
    })
  })

  it('keeps Windows cmd arguments unchanged so cross-spawn can quote them', () => {
    const result = resolveSpawnCommand('npx.cmd', ['playwright', 'test', 'spec with spaces.ts', '--grep="foo bar"'], {
      platform: 'win32',
    })

    expect(result).toEqual({
      command: 'npx.cmd',
      args: ['playwright', 'test', 'spec with spaces.ts', '--grep="foo bar"'],
      spawnOptions: {},
    })
  })

  it('rejects unsafe Windows cmd arguments before shell handoff', () => {
    expect(() => resolveSpawnCommand('yarn.cmd', ['%PATH%'], { platform: 'win32' })).toThrow(
      'Windows command argument #1 contains unsupported characters',
    )
  })
})
