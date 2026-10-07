import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import {
  extractModuleRequiresFromSource,
  findMissingModuleRequires,
  generateModuleRegistry,
  generateModuleRegistryApp,
  generateModuleRegistryCli,
} from '../module-registry'

let tmpDir: string

function writeSource(relativePath: string, source: string): string {
  const fullPath = path.join(tmpDir, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, source)
  return fullPath
}

function createStandaloneSrcMirrorResolver(enabled: ModuleEntry[]): PackageResolver {
  const outputDir = path.join(tmpDir, '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
  return {
    isMonorepo: () => false,
    getRootDir: () => tmpDir,
    getAppDir: () => tmpDir,
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpDir, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpDir, 'src', 'modules', entry.id),
      pkgBase: path.join(tmpDir, 'node_modules', 'pkg', 'dist', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'node_modules', 'pkg'),
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-requires-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractModuleRequiresFromSource', () => {
  it('reads requires from a packaged TypeScript source without executing it', () => {
    const file = writeSource('node_modules/pkg/src/modules/workflows/index.ts', `
      import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
      import './commands'
      throw new Error('module side effects must not run')
      export const metadata: ModuleInfo = {
        name: 'workflows',
        requires: ['business_rules'],
      }
    `)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'declared', requires: ['business_rules'] })
  })

  it('ignores the word requires inside comments', () => {
    const file = writeSource('index.ts', `
      // requires: ['commented_out']
      /* metadata.requires: ['also_commented'] */
      export const metadata = {
        name: 'example',
        /** requires: ['jsdoc_mention'] */
      }
    `)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'absent' })
  })

  it('ignores unrelated objects that carry a requires field', () => {
    const file = writeSource('index.ts', `
      const settings = { requires: ['not_a_module'] }
      export const config = { requires: ['also_not_a_module'] }
      export const metadata = { name: 'example', requires: ['auth'] }
      export function build() { return { requires: ['runtime_value'] } }
    `)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'declared', requires: ['auth'] })
  })

  it('ignores a local metadata object that is not exported', () => {
    const file = writeSource('index.ts', `
      const metadata = { requires: ['auth'] }
      export const info = metadata
    `)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'absent' })
  })

  it.each([
    ['a type annotation', `export const metadata: ModuleInfo = { requires: ['auth', 'attachments'] }`],
    ['an as-assertion', `export const metadata = { requires: ['auth', 'attachments'] } as ModuleInfo`],
    ['a satisfies clause', `export const metadata = { requires: ['auth', 'attachments'] as const } satisfies ModuleInfo`],
    ['a quoted key and template literal', `export const metadata = { 'requires': [\`auth\`, "attachments"] }`],
  ])('reads typed object literals with %s', (_label, declaration) => {
    const file = writeSource('index.ts', `import type { ModuleInfo } from '@open-mercato/shared/modules/registry'\n${declaration}\n`)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'declared', requires: ['auth', 'attachments'] })
  })

  it('reads compiled ESM output', () => {
    const file = writeSource('node_modules/pkg/dist/modules/workflows/index.js', `
      import "./commands";
      const metadata = { name: "workflows", requires: ["business_rules"] };
      export { metadata };
    `)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'declared', requires: ['business_rules'] })
  })

  it('reads an aliased named export', () => {
    const file = writeSource('index.js', `
      const moduleInfo = { requires: ["auth"] };
      export { moduleInfo as metadata };
    `)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'declared', requires: ['auth'] })
  })

  it.each([
    ['exports.metadata', `exports.metadata = { requires: ['auth'] }`],
    ['module.exports.metadata', `module.exports.metadata = { requires: ['auth'] }`],
  ])('reads compiled CommonJS output assigning %s', (_label, assignment) => {
    const file = writeSource('index.js', `"use strict";\n${assignment};\n`)
    expect(extractModuleRequiresFromSource(file)).toEqual({ status: 'declared', requires: ['auth'] })
  })

  it.each([
    ['an identifier entry', `const DEP = 'auth'\nexport const metadata = { requires: [DEP] }`, 'non-literal entry'],
    ['a spread entry', `const base = ['auth']\nexport const metadata = { requires: [...base, 'attachments'] }`, 'non-literal entry'],
    ['an interpolated template', `const id = 'auth'\nexport const metadata = { requires: [\`\${id}\`] }`, 'non-literal entry'],
    ['an identifier array', `const deps = ['auth']\nexport const metadata = { requires: deps }`, 'not an array literal'],
    ['a metadata spread', `const base = { requires: ['auth'] }\nexport const metadata = { ...base }`, 'uses a spread'],
    ['a shorthand property', `const requires = ['auth']\nexport const metadata = { requires }`, 'not a property assignment'],
    ['a non-literal metadata', `export const metadata = buildMetadata()`, 'not an object literal'],
  ])('reports %s as unresolvable instead of guessing', (_label, source, reason) => {
    const file = writeSource('index.ts', `${source}\n`)
    const extraction = extractModuleRequiresFromSource(file)
    expect(extraction.status).toBe('unresolvable')
    expect(extraction.status === 'unresolvable' && extraction.reason).toContain(reason)
  })

  it('returns absent when there is no requires or no file', () => {
    expect(extractModuleRequiresFromSource(writeSource('index.ts', `export const metadata = { name: 'x' }\n`)))
      .toEqual({ status: 'absent' })
    expect(extractModuleRequiresFromSource(path.join(tmpDir, 'missing.ts'))).toEqual({ status: 'absent' })
  })
})

describe('findMissingModuleRequires', () => {
  it('lists only the dependencies that are not enabled', () => {
    const requiresByModule = new Map([
      ['workflows', ['business_rules']],
      ['agent_orchestrator', ['workflows', 'api_keys', 'auth', 'attachments']],
    ])
    expect(findMissingModuleRequires([{ id: 'workflows' }, { id: 'agent_orchestrator' }, { id: 'auth' }], requiresByModule))
      .toEqual([
        { moduleId: 'workflows', missing: ['business_rules'] },
        { moduleId: 'agent_orchestrator', missing: ['api_keys', 'attachments'] },
      ])
  })
})

describe('module dependency validation during generate', () => {
  let exitSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    writeSource(
      'node_modules/pkg/src/modules/workflows/index.ts',
      `import type { ModuleInfo } from '@open-mercato/shared/modules/registry'\n`
        + `throw new Error('module side effects must not run')\n`
        + `export const metadata: ModuleInfo = { name: 'workflows', requires: ['business_rules'] }\n`,
    )
    writeSource(
      'node_modules/pkg/dist/modules/workflows/index.js',
      `throw new Error('module side effects must not run');\n`
        + `export const metadata = { name: 'workflows', requires: ['business_rules'] };\n`,
    )
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it.each([
    ['generateModuleRegistry', generateModuleRegistry],
    ['generateModuleRegistryApp', generateModuleRegistryApp],
    ['generateModuleRegistryCli', generateModuleRegistryCli],
  ])('%s fails when a packaged TypeScript module misses a required module', async (_label, generate) => {
    const resolver = createStandaloneSrcMirrorResolver([{ id: 'workflows', from: '@open-mercato/core' }])
    await expect(generate({ resolver, quiet: true })).rejects.toThrow('process.exit(1)')
    const printed = errorSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('Module "workflows" requires: business_rules')
    expect(printed).toContain("export const enabledModules = [ { id: 'business_rules' } ]")
  })

  it.each([
    ['generateModuleRegistry', generateModuleRegistry],
    ['generateModuleRegistryApp', generateModuleRegistryApp],
    ['generateModuleRegistryCli', generateModuleRegistryCli],
  ])('%s passes when every required module is enabled', async (_label, generate) => {
    const resolver = createStandaloneSrcMirrorResolver([
      { id: 'workflows', from: '@open-mercato/core' },
      { id: 'business_rules', from: '@open-mercato/core' },
    ])
    const result = await generate({ resolver, quiet: true })
    expect(result.errors).toEqual([])
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
