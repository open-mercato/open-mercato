import 'reflect-metadata'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const entities = new Set()
const owners = new Map()
const declarations = new Map()
const packages = await readdir(path.join(repository, 'packages'), { withFileTypes: true })

for (const workspace of packages.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
  const packageRoot = path.join(repository, 'packages', workspace.name)
  const modulesRoot = path.join(packageRoot, 'src/modules')
  let modules
  try { modules = await readdir(modulesRoot, { withFileTypes: true }) } catch (error) {
    if (error.code === 'ENOENT') continue
    throw error
  }
  for (const module of modules.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const declarationFile = path.join(packageRoot, 'dist/modules', module.name, 'database.js')
    try {
      await access(declarationFile)
      declarations.set(module.name, (await import(pathToFileURL(declarationFile).href)).databaseDeclarations)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    try { await access(path.join(modulesRoot, module.name, 'data/entities.ts')) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    const compiled = path.join(packageRoot, 'dist/modules', module.name, 'data/entities.js')
    const namespace = await import(pathToFileURL(compiled).href)
    for (const [name, entity] of Object.entries(namespace)) {
      if (typeof entity !== 'function') continue
      if (!Object.hasOwn(entity, 'entityName')) Object.defineProperty(entity, 'entityName', { value: `${module.name}.${name}`, configurable: true })
      entities.add(entity)
      owners.set(entity, module.name)
    }
  }
}

const generatedPath = path.join(repository, 'apps/mercato/.mercato/generated/entities.generated.ts')
const localEntities = (await import(pathToFileURL(generatedPath).href)).entities
for (const entity of localEntities) {
  if (owners.has(entity)) continue
  entities.add(entity)
  owners.set(entity, entity.entityName?.split('.')[0] ?? 'app')
}

const orm = await MikroORM.init({
  driver: PostgreSqlDriver,
  clientUrl: 'postgresql://unused@127.0.0.1:1/offline',
  entities: [...entities],
  metadataProvider: ReflectMetadataProvider,
  connect: false,
})
try {
  const entries = []
  for (const metadata of orm.getMetadata().getAll().values()) {
    if (!metadata.tableName || metadata.abstract || metadata.embeddable) continue
    const tenant = Object.values(metadata.properties).find((property) => property.fieldNames?.includes('tenant_id'))
    const owner = owners.get(metadata.class) ?? 'app'
    const declaration = declarations.get(owner)
    const override = declaration?.tables?.find((table) => table.table === metadata.tableName)
    const classification = override?.classification ?? declaration?.tableClassification ?? (!tenant ? 'global' : tenant.nullable ? 'mixed' : 'deferred')
    const reason = override?.reason ?? (classification === 'enforced' ? 'Explicit module-owned enrollment.'
      : classification === 'identity' ? `${owner} identity/bootstrap storage is required before authoritative tenant resolution.`
        : classification === 'global' ? `${owner} storage has no direct tenant column and needs a separate authorization model.`
          : classification === 'mixed' ? `${owner} permits null-tenant rows; global-row semantics require separate policy review.`
            : `${owner} remains application-scoped until its queries and maintenance paths are reviewed for enrollment.`)
    entries.push({
      schema: metadata.schema ?? 'public', table: metadata.tableName, owner, classification, reason,
      tenantColumn: tenant ? 'tenant_id' : null,
      tenantType: tenant?.columnTypes?.[0] ?? null,
      tenantNullable: tenant ? Boolean(tenant.nullable) : null,
      policyVersion: classification === 'enforced' ? 1 : null,
    })
  }
  for (const [owner, declaration] of declarations) {
    for (const table of declaration.storageTables ?? []) {
      if (entries.some((entry) => entry.schema === table.schema && entry.table === table.table)) {
        throw new Error('[internal] Declared storage table conflicts with discovered ORM metadata')
      }
      entries.push({ ...table, owner, policyVersion: null })
    }
  }
  entries.sort((left, right) => `${left.schema}.${left.table}`.localeCompare(`${right.schema}.${right.table}`))
  const identities = entries.map((entry) => `${entry.schema}.${entry.table}`)
  if (new Set(identities).size !== entries.length) throw new Error('[internal] RLS inventory has conflicting table identities')
  const output = fileURLToPath(new URL('../src/lib/rls/runtime/tableInventory.generated.ts', import.meta.url))
  const body = '// AUTO-GENERATED by packages/enterprise/scripts/generate-rls-table-inventory.mjs\nexport const tenantTableInventory = {\n  "version": 1,\n  "tables": [\n' + entries.map((entry) => '    ' + JSON.stringify(entry)).join(',\n') + '\n  ]\n} as const\n'
  const existing = await readFile(output, 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error })
  if (existing !== body) await writeFile(output, body)
  process.stdout.write(`RLS table inventory: ${entries.length} explicit tables; candidate classifications require review before enrollment.\n`)
} finally {
  await orm.close(true)
}
