import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertModuleNotGatedOff,
  ensureModuleRegistration,
  ModuleGatedOffError,
  setModuleRegistrationSource,
} from '../modules-config'

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
      'OM_ENABLE_ENTERPRISE_MODULES_SECURITY',
      'OM_ENABLE_ENTERPRISE_MODULES_AGENTS',
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
      for (const name of flagNames) {
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

    function readGatedOffError(filePath: string, id: string): ModuleGatedOffError {
      try {
        ensureModuleRegistration(filePath, { id, from: '@open-mercato/gated' })
      } catch (error) {
        if (error instanceof ModuleGatedOffError) return error
        throw error
      }
      throw new Error(`[internal] expected module "${id}" to be gated off`)
    }

    function writeConditionFile(statements: string[]): string {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        [
          "import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'",
          '',
          'const enterpriseEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false)',
          'const s3Disabled = !parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)',
          '',
          'export const enabledModules = []',
          '',
          ...statements,
        ].join('\n'),
      )
      return filePath
    }

    it.each([
      [
        'a negated operand inside &&',
        ['if (enterpriseEnabled && !parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {'],
      ],
      ['a comparison inside &&', ["if (enterpriseEnabled && process.env.OM_ENABLE_STORAGE_S3 !== 'true') {"]],
      ['a negated variable inside &&', ['if (enterpriseEnabled && s3Disabled) {']],
      ['a variable the parser does not know', ['if (enterpriseEnabled && unknownFlag) {']],
      ['an || condition', ['if (enterpriseEnabled || parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO, false)) {']],
    ])('asks to make the condition true for %s', (_label, condition) => {
      process.env.OM_ENABLE_STORAGE_S3 = 'true'
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO
      const filePath = writeConditionFile([
        ...condition,
        "  enabledModules.push({ id: 'gated', from: '@open-mercato/gated' })",
        '}',
      ])

      const error = readGatedOffError(filePath, 'gated')
      expect(error.message).toContain('Make that condition true to enable it.')
      expect(error.message).not.toMatch(/=true/)
      expect(error.envFlags).toEqual([])
    })

    it('keeps an inner condition unvouched when the outer condition is not understood', () => {
      process.env.OM_ENABLE_STORAGE_S3 = 'true'
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES
      const filePath = writeConditionFile([
        'if (s3Disabled) {',
        '  if (enterpriseEnabled) {',
        "    enabledModules.push({ id: 'gated', from: '@open-mercato/gated' })",
        '  }',
        '}',
      ])

      const error = readGatedOffError(filePath, 'gated')
      expect(error.message).toContain('Make that condition true to enable it.')
      expect(error.envFlags).toEqual([])
    })

    it('names the flags of nested positive conditions', () => {
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO
      const filePath = writeConditionFile([
        'if (enterpriseEnabled) {',
        '  if (parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO, false)) {',
        "    enabledModules.push({ id: 'gated', from: '@open-mercato/gated' })",
        '  }',
        '}',
      ])

      const error = readGatedOffError(filePath, 'gated')
      expect(error.envFlags).toEqual(['OM_ENABLE_ENTERPRISE_MODULES', 'OM_ENABLE_ENTERPRISE_MODULES_SSO'])
      expect(error.message).toContain('OM_ENABLE_ENTERPRISE_MODULES=true and OM_ENABLE_ENTERPRISE_MODULES_SSO=true')
    })

    it('throws a ModuleGatedOffError carrying the flags for a gated template module', () => {
      delete process.env.OM_ENABLE_STORAGE_S3
      const templatePath = path.resolve(__dirname, '../../../../create-app/template/src/modules.ts')
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.copyFileSync(templatePath, filePath)

      let thrown: unknown
      try {
        assertModuleNotGatedOff(filePath, 'storage_s3')
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ModuleGatedOffError)
      const gatedOff = thrown as ModuleGatedOffError
      expect(gatedOff.code).toBe('MODULE_GATED_OFF')
      expect(gatedOff.moduleId).toBe('storage_s3')
      expect(gatedOff.envFlags).toEqual(['OM_ENABLE_STORAGE_S3'])
      expect(gatedOff.message).toContain('OM_ENABLE_STORAGE_S3=true')
      expect(() => assertModuleNotGatedOff(filePath, 'auth')).not.toThrow()
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

  describe('preserves the rest of the file when appending a module', () => {
    const appendEntry = (source: string): string => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(filePath, source)
      const result = ensureModuleRegistration(filePath, {
        id: 'storage_s3',
        from: '@open-mercato/storage-s3',
      })
      expect(result.changed).toBe(true)
      return fs.readFileSync(filePath, 'utf8')
    }

    it('keeps line comments, block comments, blank lines and commented-out entries', () => {
      const source = [
        '// Central place to enable modules.',
        'export const enabledModules: ModuleEntry[] = [',
        "  { id: 'auth', from: '@open-mercato/core' },",
        '  // customer_groups stays disabled by default:',
        '  // enabling it needs extra harness coverage.',
        "  // { id: 'customer_groups', from: '@open-mercato/core' },",
        '',
        '  /* Communication channels hub.',
        '   * Provider packages register adapters here. */',
        "  { id: 'communication_channels', from: '@open-mercato/core' }, // trailing note",
        "  // { id: 'cart', from: '@open-mercato/core' },",
        ']',
        '',
        "if (process.env.OM_ENABLE_ENTERPRISE_MODULES === 'true') {",
        "  // enterprise modules",
        "  enabledModules.push({ id: 'record_locks', from: '@open-mercato/enterprise' })",
        '}',
        '',
      ].join('\n')

      const updated = appendEntry(source)

      expect(updated).toBe(
        source.replace(
          "  { id: 'communication_channels', from: '@open-mercato/core' }, // trailing note\n",
          "  { id: 'communication_channels', from: '@open-mercato/core' }, // trailing note\n" +
            "  { id: 'storage_s3', from: '@open-mercato/storage-s3' },\n",
        ),
      )
    })

    it('adds a separating comma when the last element has none', () => {
      const source = [
        'export const enabledModules = [',
        "  { id: 'auth', from: '@open-mercato/core' } // no trailing comma",
        '  // closing comment',
        ']',
        '',
      ].join('\n')

      expect(appendEntry(source)).toBe(
        [
          'export const enabledModules = [',
          "  { id: 'auth', from: '@open-mercato/core' }, // no trailing comma",
          "  { id: 'storage_s3', from: '@open-mercato/storage-s3' }",
          '  // closing comment',
          ']',
          '',
        ].join('\n'),
      )
    })

    it('fills an empty array and keeps its comments', () => {
      expect(appendEntry('export const enabledModules = []\n')).toBe(
        "export const enabledModules = [\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' },\n]\n",
      )
      expect(
        appendEntry('export const enabledModules = [\n  // nothing yet\n]\n'),
      ).toBe(
        "export const enabledModules = [\n  // nothing yet\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' },\n]\n",
      )
    })

    it('keeps CRLF line endings', () => {
      const source = "export const enabledModules = [\r\n  // core\r\n  { id: 'auth', from: '@open-mercato/core' },\r\n]\r\n"
      expect(appendEntry(source)).toBe(
        "export const enabledModules = [\r\n  // core\r\n  { id: 'auth', from: '@open-mercato/core' },\r\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' },\r\n]\r\n",
      )
    })

    it('handles a spread or a comma-less last element', () => {
      expect(
        appendEntry("export const enabledModules = [\n  { id: 'auth' },\n  ...officialModuleEntries,\n]\n"),
      ).toBe(
        "export const enabledModules = [\n  { id: 'auth' },\n  ...officialModuleEntries,\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' },\n]\n",
      )
      expect(appendEntry("export const enabledModules = [\n  { id: 'auth' }\n]\n")).toBe(
        "export const enabledModules = [\n  { id: 'auth' },\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' }\n]\n",
      )
    })

    it('indents from the opening line when brackets share a line with elements', () => {
      expect(appendEntry("export const enabledModules = [{ id: 'auth' }]\n")).toBe(
        "export const enabledModules = [{ id: 'auth' },\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' }\n]\n",
      )
      expect(appendEntry("export const enabledModules = [\n  { id: 'auth' },\n  { id: 'directory' }]\n")).toBe(
        "export const enabledModules = [\n  { id: 'auth' },\n  { id: 'directory' },\n  { id: 'storage_s3', from: '@open-mercato/storage-s3' }\n]\n",
      )
    })

    it('leaves the create-app template untouched apart from the new entry', () => {
      const templatePath = path.resolve(__dirname, '../../../../create-app/template/src/modules.ts')
      const source = fs.readFileSync(templatePath, 'utf8')
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(filePath, source)
      const added = "  { id: 'template_probe', from: '@open-mercato/template-probe' },\n"

      expect(source).not.toContain('template_probe')
      expect(
        ensureModuleRegistration(filePath, { id: 'template_probe', from: '@open-mercato/template-probe' }).changed,
      ).toBe(true)

      const updated = fs.readFileSync(filePath, 'utf8')
      expect(updated.length).toBe(source.length + added.length)
      expect(updated.replace(added, '')).toBe(source)
      expect(updated.split('\n').filter((line) => line.trim().startsWith('//'))).toEqual(
        source.split('\n').filter((line) => line.trim().startsWith('//')),
      )
    })
  })
})
