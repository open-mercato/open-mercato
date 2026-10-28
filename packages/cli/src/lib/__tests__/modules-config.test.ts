import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureModuleRegistration, setModuleRegistrationSource } from '../modules-config'

describe('modules-config', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
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

  describe('env-gated registrations', () => {
    const flagNames = [
      'OM_ENABLE_STORAGE_S3',
      'OM_ENABLE_ENTERPRISE_MODULES',
      'OM_ENABLE_ENTERPRISE_MODULES_SSO',
    ]
    const originalEnv = Object.fromEntries(flagNames.map((name) => [name, process.env[name]]))

    afterEach(() => {
      for (const name of flagNames) {
        if (originalEnv[name] === undefined) delete process.env[name]
        else process.env[name] = originalEnv[name]
      }
    })

    function writeGatedModulesFile(): string {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        [
          "import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'",
          '',
          'export const enabledModules = [',
          "  { id: 'auth', from: '@open-mercato/core' },",
          ']',
          '',
          'if (parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {',
          "  enabledModules.push({ id: 'storage_s3', from: '@open-mercato/storage-s3' })",
          '}',
          '',
          'const enterpriseModulesEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false)',
          'const enterpriseSsoEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO, false)',
          '',
          'if (enterpriseModulesEnabled && enterpriseSsoEnabled) {',
          "  enabledModules.push({ id: 'sso', from: '@open-mercato/enterprise' })",
          '}',
        ].join('\n'),
      )
      return filePath
    }

    it('refuses to add a second entry for a module gated by a disabled env flag and names the flag', () => {
      delete process.env.OM_ENABLE_STORAGE_S3
      const filePath = writeGatedModulesFile()
      const before = fs.readFileSync(filePath, 'utf8')

      expect(() =>
        ensureModuleRegistration(filePath, { id: 'storage_s3', from: '@open-mercato/storage-s3' }),
      ).toThrow(/storage_s3.*OM_ENABLE_STORAGE_S3=true/s)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    })

    it('treats a gated module whose env flag is on as already registered', () => {
      process.env.OM_ENABLE_STORAGE_S3 = 'true'
      const filePath = writeGatedModulesFile()
      const before = fs.readFileSync(filePath, 'utf8')

      const result = ensureModuleRegistration(filePath, {
        id: 'storage_s3',
        from: '@open-mercato/storage-s3',
      })

      expect(result).toEqual({ changed: false, registeredAs: '@open-mercato/storage-s3' })
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    })

    it('names only the env flags still off when a gate reads them through variables', () => {
      process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO
      const filePath = writeGatedModulesFile()

      let message = ''
      try {
        ensureModuleRegistration(filePath, { id: 'sso', from: '@open-mercato/enterprise' })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      expect(message).toContain('OM_ENABLE_ENTERPRISE_MODULES_SSO=true')
      expect(message).not.toContain('OM_ENABLE_ENTERPRISE_MODULES=true')
    })

    it('covers every env-gated module of the create-app template', () => {
      for (const name of [...flagNames, 'OM_ENABLE_ENTERPRISE_MODULES_SECURITY', 'OM_ENABLE_ENTERPRISE_MODULES_AGENTS']) {
        delete process.env[name]
      }
      const templatePath = path.resolve(__dirname, '../../../../create-app/template/src/modules.ts')
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.copyFileSync(templatePath, filePath)
      const before = fs.readFileSync(filePath, 'utf8')

      const gatedModules: Array<{ id: string; from: string; flag: RegExp }> = [
        { id: 'storage_s3', from: '@open-mercato/storage-s3', flag: /OM_ENABLE_STORAGE_S3=true/ },
        { id: 'record_locks', from: '@open-mercato/enterprise', flag: /OM_ENABLE_ENTERPRISE_MODULES=true/ },
        { id: 'system_status_overlays', from: '@open-mercato/enterprise', flag: /OM_ENABLE_ENTERPRISE_MODULES=true/ },
        { id: 'sso', from: '@open-mercato/enterprise', flag: /OM_ENABLE_ENTERPRISE_MODULES_SSO=true/ },
        { id: 'security', from: '@open-mercato/enterprise', flag: /OM_ENABLE_ENTERPRISE_MODULES_SECURITY=true/ },
        { id: 'agent_orchestrator', from: '@open-mercato/enterprise', flag: /OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true/ },
      ]

      for (const gated of gatedModules) {
        expect(() => ensureModuleRegistration(filePath, { id: gated.id, from: gated.from })).toThrow(gated.flag)
      }
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    })

    it('never suggests a flag value it cannot vouch for', () => {
      process.env.OM_ENABLE_STORAGE_S3 = 'true'
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        [
          "import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'",
          '',
          'const enableS3 = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false)',
          'const settings = { enableS3: false }',
          '',
          'export const enabledModules = []',
          '',
          'if (!parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {',
          "  enabledModules.push({ id: 'negated', from: '@open-mercato/negated' })",
          '}',
          '',
          'if (parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {',
          "  enabledModules.push({ id: 'unrelated', from: '@open-mercato/unrelated' })",
          '} else {',
          "  enabledModules.push({ id: 'fallback', from: '@open-mercato/fallback' })",
          '}',
          '',
          'if (settings.enableS3) {',
          "  enabledModules.push({ id: 'property_gated', from: '@open-mercato/property-gated' })",
          '}',
        ].join('\n'),
      )

      for (const id of ['negated', 'fallback', 'property_gated']) {
        let message = ''
        try {
          ensureModuleRegistration(filePath, { id, from: `@open-mercato/${id.replace('_', '-')}` })
        } catch (error) {
          message = error instanceof Error ? error.message : String(error)
        }
        expect(message).toContain('Make that condition true to enable it.')
        expect(message).not.toMatch(/=true/)
      }
    })

    it('ignores inactive gated entries when switching the source of an active registration', () => {
      delete process.env.OM_ENABLE_STORAGE_S3
      const filePath = writeGatedModulesFile()

      expect(() => setModuleRegistrationSource(filePath, 'storage_s3', '@app')).toThrow(
        /Could not find module entry for "storage_s3"/,
      )
      expect(setModuleRegistrationSource(filePath, 'auth', '@app')).toEqual({ changed: true })
    })
  })
})
