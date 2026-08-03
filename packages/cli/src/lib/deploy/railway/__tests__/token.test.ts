import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readCachedRailwayToken,
  resolveRailwayToken,
  writeCachedRailwayToken,
} from '../token'

describe('Railway token resolution', () => {
  it('uses flag, environment, then cache precedence', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-token-'))
    const configPath = join(cwd, 'railway.json')
    writeCachedRailwayToken(configPath, 'cached-token')

    expect(resolveRailwayToken({
      flagToken: 'flag-token',
      environment: { RAILWAY_API_TOKEN: 'environment-token' },
      configPath,
    })).toEqual({ token: 'flag-token', source: 'flag' })
    expect(resolveRailwayToken({
      environment: { RAILWAY_API_TOKEN: 'environment-token' },
      configPath,
    })).toEqual({ token: 'environment-token', source: 'environment' })
    expect(resolveRailwayToken({ environment: {}, configPath }))
      .toEqual({ token: 'cached-token', source: 'cache' })
  })

  it('writes a private cache file and rejects broad permissions', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-token-'))
    const configPath = join(cwd, 'railway.json')
    writeCachedRailwayToken(configPath, 'cached-token')

    expect(statSync(configPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(configPath, 'utf8')).toContain('cached-token')
    chmodSync(configPath, 0o644)
    expect(() => readCachedRailwayToken(configPath, 'linux')).toThrow('permissions must be 0600')
  })
})
