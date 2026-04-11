import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const packageRoot = path.join(repoRoot, 'packages/shared')
const baseDir = fs.mkdtempSync(path.join(packageRoot, '.tmp-dynamic-loader-fixture-'))
const appRoot = path.join(baseDir, 'app')
const generatedDir = path.join(appRoot, '.mercato', 'generated')
fs.mkdirSync(generatedDir, { recursive: true })
fs.writeFileSync(path.join(generatedDir, 'entities.ids.generated.ts'), "export const E = { customers: { person: 'customers:person' } }\n", 'utf8')
fs.writeFileSync(path.join(generatedDir, 'modules.cli.generated.ts'), "export const modules = [{ id: 'cli-module' }]\n", 'utf8')
fs.writeFileSync(path.join(generatedDir, 'entities.generated.ts'), "export const entities = [{ name: 'CliEntity' }]\n", 'utf8')
fs.writeFileSync(path.join(generatedDir, 'di.generated.ts'), "export const diRegistrars = [() => undefined]\n", 'utf8')

const dynamicLoader = await import(pathToFileURL(path.join(packageRoot, 'src/lib/bootstrap/dynamicLoader.ts')).href)
const factory = await import(pathToFileURL(path.join(packageRoot, 'src/lib/bootstrap/factory.ts')).href)
const modulesRegistry = await import(pathToFileURL(path.join(packageRoot, 'src/lib/modules/registry.ts')).href)
const mikro = await import(pathToFileURL(path.join(packageRoot, 'src/lib/db/mikro.ts')).href)
const di = await import(pathToFileURL(path.join(packageRoot, 'src/lib/di/container.ts')).href)
const entityIds = await import(pathToFileURL(path.join(packageRoot, 'src/lib/encryption/entityIds.ts')).href)

try {
  const data = await dynamicLoader.bootstrapFromAppRoot(appRoot)
  console.log(JSON.stringify({
    returned: {
      modules: data.modules,
      entities: data.entities,
      entityIds: data.entityIds,
      searchModuleConfigs: data.searchModuleConfigs,
    },
    state: {
      bootstrapped: factory.isBootstrapped(),
      modules: modulesRegistry.getModules(),
      ormEntities: mikro.getOrmEntities(),
      diRegistrarsCount: di.getDiRegistrars().length,
      entityIds: entityIds.getEntityIds(),
    },
  }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  fs.rmSync(baseDir, { recursive: true, force: true })
  fs.rmSync(tmpdir, { recursive: true, force: true })
}
