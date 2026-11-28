import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript-js'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleRegistry } from '../module-registry'

const REPO_ROOT = path.resolve(__dirname, '../../../../../..')
let fixtureRoot: string

function write(relative: string, content: string): void {
  const target = path.join(fixtureRoot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

beforeEach(() => { fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-access-generator-')) })
afterEach(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))

it.each([false, true])('discovers nested attachment policies and removes disabled adopters (standalone=%s)', async (standalone) => {
  const packageRoot = standalone ? 'node_modules/fixture' : 'packages/core'
  const moduleRoot = `${packageRoot}/${standalone ? 'dist' : 'src'}/modules`
  const extension = standalone ? 'js' : 'ts'
  const source = fs.readFileSync(path.join(REPO_ROOT, 'packages/core/src/modules/attachments/generators.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  write(`${moduleRoot}/attachments/generators.${extension}`, compiled)
  write(`${moduleRoot}/documents/data/attachment-access.${extension}`, 'export const attachmentAccessResolvers = []; export const protectedAttachmentTargets = []')
  write(`${moduleRoot}/clinical/data/attachment-access.${extension}`, 'export const attachmentAccessResolvers = []')
  const outputDir = path.join(fixtureRoot, '.mercato/generated')
  const entries: ModuleEntry[] = [
    { id: 'attachments', from: '@open-mercato/core' },
    { id: 'documents', from: '@open-mercato/documents' },
    { id: 'clinical', from: '@open-mercato/core' },
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
  const first = await generateModuleRegistry({ resolver, quiet: true })
  expect(first.errors).toEqual([])
  const read = (name: string) => fs.readFileSync(path.join(outputDir, name), 'utf8')
  const registry = read('attachment-access.generated.ts')
  expect(registry).toContain('@open-mercato/documents/modules/documents/data/attachment-access')
  expect(registry).toContain('protectedAttachmentTargets')
  expect(registry.indexOf("moduleId: 'documents'")).toBeLessThan(registry.indexOf("moduleId: 'clinical'"))
  expect(read('bootstrap-registrations.generated.ts')).toContain('registerAttachmentAccessResolvers(attachmentAccessEntries)')

  entries.splice(1, 1)
  const second = await generateModuleRegistry({ resolver, quiet: true })
  expect(second.errors).toEqual([])
  expect(read('attachment-access.generated.ts')).not.toContain('documents/data/attachment-access')
  expect(read('attachment-access.generated.ts')).toContain('clinical/data/attachment-access')
})
