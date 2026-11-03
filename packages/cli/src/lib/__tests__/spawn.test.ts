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

describe('resolveSpawnCommand detached passthrough', () => {
  // The whole process-group teardown in the ephemeral harness rests on this flag reaching `spawn`:
  // without it the app tree stays in the runner's group and the negated-pid kill has nothing of its
  // own to signal.
  it('passes detached through on the POSIX branch', () => {
    const result = resolveSpawnCommand('yarn', ['start'], { platform: 'linux', detached: true })

    expect(result.spawnOptions).toEqual({ detached: true })
  })

  it('passes detached through on the Windows cmd branch', () => {
    const result = resolveSpawnCommand('yarn.cmd', ['start'], { platform: 'win32', detached: true })

    expect(result.spawnOptions).toEqual({ detached: true })
  })

  it('omits detached entirely when the caller does not ask for it', () => {
    expect(resolveSpawnCommand('yarn', ['start'], { platform: 'linux' }).spawnOptions).toEqual({})
    expect(resolveSpawnCommand('yarn', ['start']).spawnOptions).not.toHaveProperty('detached')
    expect(resolveSpawnCommand('yarn', ['start'], { platform: 'linux', detached: false }).spawnOptions).toEqual({})
  })
})
