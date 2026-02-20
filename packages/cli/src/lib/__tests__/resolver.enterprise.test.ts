import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResolver } from '../resolver'

function writeModulesConfig(rootDir: string, entries: Array<{ id: string; from: string }>) {
  const srcDir = path.join(rootDir, 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  const lines = entries.map((entry) => `  { id: '${entry.id}', from: '${entry.from}' },`).join('\n')
  fs.writeFileSync(
    path.join(srcDir, 'modules.ts'),
    `export const enabledModules = [\n${lines}\n]\n`,
    'utf8',
  )
}

describe('resolver enterprise module toggle', () => {
  const originalEnv = process.env.OM_ENABLE_ENTERPRISE_MODULES

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    } else {
      process.env.OM_ENABLE_ENTERPRISE_MODULES = originalEnv
    }
  })

  it('injects enterprise record_locks when toggle is enabled', () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfig(tempDir, [{ id: 'customers', from: '@open-mercato/core' }])

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual(
      expect.arrayContaining([
        { id: 'customers', from: '@open-mercato/core' },
        { id: 'record_locks', from: '@open-mercato/enterprise' },
      ]),
    )
  })

  it('removes non-app record_locks when toggle is disabled', () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'false'
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfig(tempDir, [
      { id: 'customers', from: '@open-mercato/core' },
      { id: 'record_locks', from: '@open-mercato/core' },
    ])

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual([{ id: 'customers', from: '@open-mercato/core' }])
  })

  it('keeps app record_locks override regardless of toggle', () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'false'
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfig(tempDir, [
      { id: 'customers', from: '@open-mercato/core' },
      { id: 'record_locks', from: '@app' },
    ])

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual(
      expect.arrayContaining([
        { id: 'customers', from: '@open-mercato/core' },
        { id: 'record_locks', from: '@app' },
      ]),
    )
    expect(modules.filter((entry) => entry.id === 'record_locks')).toEqual([{ id: 'record_locks', from: '@app' }])
  })
})
