import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryCli } from '../module-registry'

let fixtureRoot: string

function write(relative: string, content: string): void {
  const target = path.join(fixtureRoot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

beforeEach(() => { fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'database-declarations-generator-')) })
afterEach(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))

it.each([false, true])('discovers neutral database declarations without enterprise (standalone=%s)', async (standalone) => {
  const packageRoot = standalone ? 'node_modules/fixture' : 'packages/core'
  const moduleRoot = `${packageRoot}/${standalone ? 'dist' : 'src'}/modules`
  const extension = standalone ? 'js' : 'ts'
  write(`${moduleRoot}/owner/database.${extension}`, 'export const databaseDeclarations = { bindingValidators: [] }')
  write(`${moduleRoot}/extension/database.${extension}`, 'export const databaseDeclarations = {}')
  const outputDir = path.join(fixtureRoot, '.mercato/generated')
  const entries: ModuleEntry[] = [
    { id: 'owner', from: '@fixture/owner' },
    { id: 'extension', from: '@fixture/extension' },
  ]
  const resolver: PackageResolver = {
    isMonorepo: () => !standalone,
    getRootDir: () => fixtureRoot,
    getAppDir: () => fixtureRoot,
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(fixtureRoot, 'src/modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => entries,
    getModulePaths: (entry) => ({
      appBase: path.join(fixtureRoot, 'src/modules', entry.id),
      pkgBase: path.join(fixtureRoot, moduleRoot, entry.id),
    }),
    getModuleImportBase: (entry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `${entry.from}/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(fixtureRoot, packageRoot),
  }
  expect((await generateModuleRegistry({ resolver, quiet: true })).errors).toEqual([])
  expect((await generateModuleRegistryCli({ resolver, quiet: true })).errors).toEqual([])
  const read = (name: string) => fs.readFileSync(path.join(outputDir, name), 'utf8')
  expect(read('database-declarations.generated.ts')).toContain('@fixture/owner/modules/owner/database')
  expect(read('database-declarations.generated.ts')).toContain('@fixture/extension/modules/extension/database')
  expect(read('bootstrap-registrations.generated.ts')).toContain('registerDatabaseModuleDeclarations(databaseModuleDeclarations)')
  expect(read('bootstrap-registrations.generated.ts')).not.toContain('@open-mercato/enterprise')
  expect(JSON.parse(read('dev-supervisor.generated.json')).requiresFullBootstrap).toBe(true)
  expect(fs.existsSync(path.join(outputDir, 'tenant-boundaries.generated.ts'))).toBe(false)

  entries.splice(0, 1)
  expect((await generateModuleRegistry({ resolver, quiet: true })).errors).toEqual([])
  expect(read('database-declarations.generated.ts')).not.toContain('@fixture/owner/modules/owner/database')
  expect(read('database-declarations.generated.ts')).toContain('@fixture/extension/modules/extension/database')

  entries.splice(0)
  expect((await generateModuleRegistry({ resolver, quiet: true })).errors).toEqual([])
  expect((await generateModuleRegistryCli({ resolver, quiet: true })).errors).toEqual([])
  expect(read('database-declarations.generated.ts')).toContain('databaseModuleDeclarations')
  expect(read('database-declarations.generated.ts')).not.toContain('@fixture/')
  expect(JSON.parse(read('dev-supervisor.generated.json')).requiresFullBootstrap).toBe(false)
})
