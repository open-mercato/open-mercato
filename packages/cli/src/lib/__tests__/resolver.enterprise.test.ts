import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResolver } from '../resolver'

function writeModulesConfig(rootDir: string) {
  const srcDir = path.join(rootDir, 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(
    path.join(srcDir, 'modules.ts'),
    `
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type ModuleEntry = { id: string; from?: '@open-mercato/core' | '@app' | string }

export const enabledModules: ModuleEntry[] = [
  { id: 'customers', from: '@open-mercato/core' },
]

if (parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false)) {
  enabledModules.push(
    { id: 'record_locks', from: '@open-mercato/enterprise' },
    { id: 'system_status_overlays', from: '@open-mercato/enterprise' },
  )
}
`,
    'utf8',
  )
}

function writeModulesConfigWithSideEffect(rootDir: string) {
  const srcDir = path.join(rootDir, 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(
    path.join(srcDir, 'modules.ts'),
    `
export type ModuleEntry = { id: string; from?: '@open-mercato/core' | '@app' | string }

export const enabledModules: ModuleEntry[] = [
  { id: 'customers', from: '@open-mercato/core' },
]

;(globalThis as Record<string, unknown>).__resolver_evaluated__ = true
`,
    'utf8',
  )
}

describe('resolver enterprise module toggle', () => {
  const originalEnv = process.env.OM_ENABLE_ENTERPRISE_MODULES
  const originalResolverMarker = (globalThis as Record<string, unknown>).__resolver_evaluated__

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    } else {
      process.env.OM_ENABLE_ENTERPRISE_MODULES = originalEnv
    }
    if (typeof originalResolverMarker === 'undefined') {
      delete (globalThis as Record<string, unknown>).__resolver_evaluated__
    } else {
      ;(globalThis as Record<string, unknown>).__resolver_evaluated__ = originalResolverMarker
    }
  })

  it('loads enterprise modules from app modules.ts when toggle is enabled', () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfig(tempDir)

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual(
      expect.arrayContaining([
        { id: 'customers', from: '@open-mercato/core' },
        { id: 'record_locks', from: '@open-mercato/enterprise' },
        { id: 'system_status_overlays', from: '@open-mercato/enterprise' },
      ]),
    )
  })

  it('does not load enterprise modules when toggle is disabled', () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'false'
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfig(tempDir)

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual([{ id: 'customers', from: '@open-mercato/core' }])
  })

  it('does not load enterprise modules when toggle is missing', () => {
    delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfig(tempDir)

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual([{ id: 'customers', from: '@open-mercato/core' }])
  })

  it('parses modules.ts statically without executing runtime side effects', () => {
    delete (globalThis as Record<string, unknown>).__resolver_evaluated__
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-enterprise-'))
    writeModulesConfigWithSideEffect(tempDir)

    const modules = createResolver(tempDir).loadEnabledModules()
    expect(modules).toEqual([{ id: 'customers', from: '@open-mercato/core' }])
    expect((globalThis as Record<string, unknown>).__resolver_evaluated__).toBeUndefined()
  })
})
