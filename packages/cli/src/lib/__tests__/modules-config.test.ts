import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureModuleRegistration, setModuleRegistrationSource } from '../modules-config'
import { readEnabledModulesFromConfig } from '../resolver'

describe('modules-config', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('preserves module locator when registering and ejecting', () => {
    const filePath = path.join(tmpDir, 'modules.ts')
    fs.writeFileSync(filePath, 'export const enabledModules = []\n')
    ensureModuleRegistration(filePath, { id: 'consents', from: '@pkarw/consents', locator: 'github:pkarw/consents', packageName: '@pkarw/consents' })
    expect(fs.readFileSync(filePath, 'utf8')).toContain("locator: 'github:pkarw/consents'")
    setModuleRegistrationSource(filePath, 'consents', '@app')
    expect(fs.readFileSync(filePath, 'utf8')).toContain("packageName: '@pkarw/consents'")
    expect(fs.readFileSync(filePath, 'utf8')).toContain("locator: 'github:pkarw/consents'")
  })

  it('adds a package-backed module without touching conditional pushes', () => {
    const filePath = path.join(tmpDir, 'modules.ts')
    fs.writeFileSync(
      filePath,
      [
        "export const enabledModules = [",
        "  { id: 'auth', from: '@open-mercato/core' },",
        "]",
        '',
        "if (process.env.OM_ENABLE_ENTERPRISE_MODULES === 'true') {",
        "  enabledModules.push({ id: 'record_locks', from: '@open-mercato/enterprise' })",
        '}',
      ].join('\n'),
    )

    const result = ensureModuleRegistration(filePath, {
      id: 'test_package',
      from: '@open-mercato/test-package',
    })

    expect(result).toEqual({
      changed: true,
      registeredAs: '@open-mercato/test-package',
    })

    const updated = fs.readFileSync(filePath, 'utf8')
    expect(updated).toContain("{ id: 'test_package', from: '@open-mercato/test-package' }")
    expect(updated).toContain("enabledModules.push({ id: 'record_locks', from: '@open-mercato/enterprise' })")
  })

  it('returns no-op when the same registration already exists', () => {
    const filePath = path.join(tmpDir, 'modules.ts')
    fs.writeFileSync(
      filePath,
      [
        "export const enabledModules = [",
        "  { id: 'test_package', from: '@open-mercato/test-package' },",
        "]",
      ].join('\n'),
    )

    const result = ensureModuleRegistration(filePath, {
      id: 'test_package',
      from: '@open-mercato/test-package',
    })

    expect(result).toEqual({
      changed: false,
      registeredAs: '@open-mercato/test-package',
    })
  })

  it('fails when the module is already registered from another source', () => {
    const filePath = path.join(tmpDir, 'modules.ts')
    fs.writeFileSync(
      filePath,
      [
        "export const enabledModules = [",
        "  { id: 'test_package', from: '@app' },",
        "]",
      ].join('\n'),
    )

    expect(() =>
      ensureModuleRegistration(filePath, {
        id: 'test_package',
        from: '@open-mercato/test-package',
      }),
    ).toThrow('already registered from "@app"')
  })

  it('updates an existing module source to @app', () => {
    const filePath = path.join(tmpDir, 'modules.ts')
    fs.writeFileSync(
      filePath,
      [
        "export const enabledModules = [",
        "  { id: 'test_package', from: '@open-mercato/test-package' },",
        "]",
      ].join('\n'),
    )

    const result = setModuleRegistrationSource(filePath, 'test_package', '@app')

    expect(result).toEqual({ changed: true })
    expect(fs.readFileSync(filePath, 'utf8')).toContain("{ id: 'test_package', from: '@app' }")
  })

  it('preserves enabledModules.some() guarded registrations when appending a module', () => {
    const filePath = path.join(tmpDir, 'modules.ts')
    fs.writeFileSync(
      filePath,
      [
        "export const enabledModules = [",
        "  { id: 'customers', from: '@open-mercato/core' },",
        "  { id: 'example', from: '@app' },",
        "]",
        '',
        "if (enabledModules.some((entry) => entry.id === 'example')) {",
        "  enabledModules.push({ id: 'example_customers_sync', from: '@app' })",
        '}',
      ].join('\n'),
    )

    const result = ensureModuleRegistration(filePath, {
      id: 'test_package',
      from: '@open-mercato/test-package',
    })

    expect(result).toEqual({
      changed: true,
      registeredAs: '@open-mercato/test-package',
    })

    const updated = fs.readFileSync(filePath, 'utf8')
    expect(updated).toContain("{ id: 'test_package', from: '@open-mercato/test-package' }")
    expect(updated).toContain("enabledModules.push({ id: 'example_customers_sync', from: '@app' })")
  })
})


describe('module provenance updates', () => {
  it('updates only top-level origin properties and preserves nested overrides', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-config-provenance-'))
    const modulesPath = path.join(root, 'modules.ts')
    try {
      fs.writeFileSync(modulesPath, "export const enabledModules = [{ id: 'consents', overrides: { custom: { from: 'nested', locator: 'keep-locator', packageName: 'keep-package' } } }]\n")
      setModuleRegistrationSource(modulesPath, 'consents', '@app', { locator: 'github:pkarw/consents', packageName: '@pkarw/consents' })
      const source = fs.readFileSync(modulesPath, 'utf8')
      expect(source).toContain("custom: { from: 'nested', locator: 'keep-locator', packageName: 'keep-package' }")
      expect(readEnabledModulesFromConfig(modulesPath)).toEqual([{ id: 'consents', from: '@app', locator: 'github:pkarw/consents', packageName: '@pkarw/consents' }])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
