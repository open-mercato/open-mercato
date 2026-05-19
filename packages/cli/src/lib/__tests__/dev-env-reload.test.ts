import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDevEnvReloader, resolveDevEnvFilePaths } from '../dev-env-reload'

describe('dev env reload helpers', () => {
  let appDir: string

  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-env-'))
  })

  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true })
  })

  it('resolves app env files in low-to-high dev precedence order', () => {
    expect(resolveDevEnvFilePaths('/tmp/app')).toEqual([
      '/tmp/app/.env',
      '/tmp/app/.env.development',
      '/tmp/app/.env.local',
      '/tmp/app/.env.development.local',
    ])
  })

  it('reloads changed app env files without overriding shell-provided values', () => {
    fs.writeFileSync(path.join(appDir, '.env'), [
      'APP_URL=http://env.example',
      'DATABASE_URL=postgres://env-database',
      'REMOVED_LATER=present',
    ].join('\n'))
    fs.writeFileSync(path.join(appDir, '.env.local'), [
      'APP_URL=http://local.example',
      'SHELL_VALUE=env-file-value',
    ].join('\n'))

    const environment: NodeJS.ProcessEnv = {
      SHELL_VALUE: 'shell-value',
    }
    const reloader = createDevEnvReloader(appDir, environment, Object.entries(environment))

    reloader.reload()

    expect(environment.APP_URL).toBe('http://local.example')
    expect(environment.DATABASE_URL).toBe('postgres://env-database')
    expect(environment.SHELL_VALUE).toBe('shell-value')
    expect(environment.REMOVED_LATER).toBe('present')

    fs.writeFileSync(path.join(appDir, '.env'), [
      'APP_URL=http://env.example',
      'DATABASE_URL=postgres://changed-database',
    ].join('\n'))
    fs.rmSync(path.join(appDir, '.env.local'))

    reloader.reload()

    expect(environment.APP_URL).toBe('http://env.example')
    expect(environment.DATABASE_URL).toBe('postgres://changed-database')
    expect(environment.SHELL_VALUE).toBe('shell-value')
    expect(environment.REMOVED_LATER).toBeUndefined()
  })
})
