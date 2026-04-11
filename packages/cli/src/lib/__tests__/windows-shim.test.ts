import { resolveWindowsCommandShim as moduleInstallShim, resolveYarnBinary as moduleInstallYarn } from '../module-install'
import { resolveWindowsCommandShim as integrationShim, resolveYarnBinary as integrationYarn } from '../testing/integration'
import { resolveWindowsCommandShim as verdaccioShim } from '../../../../../scripts/lib/verdaccio'

describe('resolveWindowsCommandShim (module-install / integration variants)', () => {
  it('wraps a .cmd binary in cmd.exe on win32', () => {
    expect(moduleInstallShim('yarn.cmd', ['install'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'yarn.cmd', 'install'],
    })
  })

  it('does not wrap a non-.cmd binary on win32', () => {
    expect(moduleInstallShim('node', ['script.js'], 'win32')).toEqual({
      command: 'node',
      args: ['script.js'],
    })
  })

  it('does not wrap any binary on linux', () => {
    expect(moduleInstallShim('yarn.cmd', ['install'], 'linux')).toEqual({
      command: 'yarn.cmd',
      args: ['install'],
    })
  })

  it('integration variant behaves identically to module-install variant', () => {
    expect(integrationShim('yarn.cmd', ['run', 'test'], 'win32')).toEqual(
      moduleInstallShim('yarn.cmd', ['run', 'test'], 'win32'),
    )
    expect(integrationShim('node', ['--version'], 'win32')).toEqual(
      moduleInstallShim('node', ['--version'], 'win32'),
    )
    expect(integrationShim('yarn.cmd', ['install'], 'linux')).toEqual(
      moduleInstallShim('yarn.cmd', ['install'], 'linux'),
    )
  })
})

describe('resolveYarnBinary', () => {
  it('returns yarn.cmd on win32', () => {
    expect(moduleInstallYarn('win32')).toBe('yarn.cmd')
    expect(integrationYarn('win32')).toBe('yarn.cmd')
  })

  it('returns yarn on linux', () => {
    expect(moduleInstallYarn('linux')).toBe('yarn')
    expect(integrationYarn('linux')).toBe('yarn')
  })

  it('returns yarn on darwin', () => {
    expect(moduleInstallYarn('darwin')).toBe('yarn')
  })
})

describe('resolveWindowsCommandShim (verdaccio variant — auto-promotes yarn)', () => {
  it('promotes yarn to yarn.cmd and wraps in cmd.exe on win32', () => {
    expect(verdaccioShim('yarn', ['install'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'yarn.cmd', 'install'],
    })
  })

  it('wraps an explicit yarn.cmd in cmd.exe on win32', () => {
    expect(verdaccioShim('yarn.cmd', ['install'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'yarn.cmd', 'install'],
    })
  })

  it('does not wrap on linux even with yarn', () => {
    expect(verdaccioShim('yarn', ['install'], 'linux')).toEqual({
      command: 'yarn',
      args: ['install'],
    })
  })

  it('does not wrap a non-.cmd binary on win32', () => {
    expect(verdaccioShim('node', ['script.js'], 'win32')).toEqual({
      command: 'node',
      args: ['script.js'],
    })
  })
})
