#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { loadEnabledModules, moduleFsRoots, moduleImportBase } from './shared/modules-config'

type GroupKey = '@app' | '@open-mercato/core' | '@open-mercato/example' | string

const OUT_CONSOLIDATED = path.resolve('generated/entities.ids.generated.ts')
const checksumFile = path.resolve('generated/entities.ids.generated.checksum')

function calculateChecksum(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

function toVar(s: string) { return s.replace(/[^a-zA-Z0-9_]/g, '_') }
function toSnake(s: string) { return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\W+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '').toLowerCase() }

function pkgModulesRootFor(from?: string) {
  if (!from || from === '@open-mercato/core') return path.resolve('packages/core/src/modules')
  const m = from.match(/^@open-mercato\/(.+)$/)
  if (m) return path.resolve(`packages/${m[1]}/src/modules`)
  // Unknown source: default to core
  return path.resolve('packages/core/src/modules')
}

function pkgRootFor(from?: string) {
  if (!from || from === '@open-mercato/core') return path.resolve('packages/core')
  const m = from.match(/^@open-mercato\/(.+)$/)
  if (m) return path.resolve(`packages/${m[1]}`)
  return path.resolve('packages/core')
}

function ensureDir(p: string) { fs.mkdirSync(path.dirname(p), { recursive: true }) }

type EntityFieldMap = Record<string, string[]>

function parseEntityFieldsFromFile(filePath: string, exportedClassNames: string[]): EntityFieldMap {
  const src = fs.readFileSync(filePath, 'utf8')
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)

  const exported = new Set(exportedClassNames)
  const result: EntityFieldMap = {}

  function getDecoratorArgNameLiteral(dec: ts.Decorator | undefined): string | undefined {
    if (!dec) return undefined
    const expr = dec.expression
    if (!ts.isCallExpression(expr)) return undefined
    if (!expr.arguments.length) return undefined
    const first = expr.arguments[0]
    if (!ts.isObjectLiteralExpression(first)) return undefined
    for (const prop of first.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'name') {
        if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text
      }
    }
    return undefined
  }

  function normalizeDbName(propertyName: string, _decoratorName?: string, nameOverride?: string): string {
    if (nameOverride) return nameOverride
    return toSnake(propertyName)
  }

  sf.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return
    const clsName = node.name.text
    if (!exported.has(clsName)) return
    const entityKey = toSnake(clsName)
    const fields: string[] = []

    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name) continue
      const name = ts.isIdentifier(member.name)
        ? member.name.text
        : ts.isStringLiteral(member.name)
          ? member.name.text
          : undefined
      if (!name) continue
      if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue
      const decorators = ts.canHaveDecorators(member)
        ? ts.getDecorators(member) ?? []
        : []
      let dbName: string | undefined
      if (decorators && decorators.length) {
        for (const d of decorators) {
          const nameOverride = getDecoratorArgNameLiteral(d)
          dbName = normalizeDbName(name, undefined, nameOverride)
          if (dbName) break
        }
      }
      if (!dbName) dbName = normalizeDbName(name)
      fields.push(dbName)
    }
    result[entityKey] = Array.from(new Set(fields))
  })

  return result
}

function rimrafDir(dir: string) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) rimrafDir(p)
    else fs.unlinkSync(p)
  }
  fs.rmdirSync(dir)
}

function writePerEntityFieldFiles(outRoot: string, fieldsByEntity: EntityFieldMap) {
  fs.mkdirSync(outRoot, { recursive: true })
  rimrafDir(outRoot)
  fs.mkdirSync(outRoot, { recursive: true })
  for (const [entity, fields] of Object.entries(fieldsByEntity)) {
    const entDir = path.join(outRoot, entity)
    fs.mkdirSync(entDir, { recursive: true })
    const idx = fields.map((f) => `export const ${toVar(f)} = '${f}'`).join('\n') + '\n'
    fs.writeFileSync(path.join(entDir, 'index.ts'), idx)
  }
}

function writeEntityFieldsRegistry(generatedRoot: string, fieldsByEntity: EntityFieldMap) {
  const entities = Object.keys(fieldsByEntity).sort()
  if (entities.length === 0) return

  const imports = entities.map((e) => `import * as ${toVar(e)} from './entities/${e}'`).join('\n')
  const registryEntries = entities.map((e) => `  ${toVar(e)}`).join(',\n')

  const src = `// AUTO-GENERATED by scripts/generate-entity-ids.ts
// Static registry for entity fields - eliminates dynamic imports for Turbopack compatibility
${imports}

export const entityFieldsRegistry: Record<string, Record<string, string>> = {
${registryEntries}
}

export function getEntityFields(slug: string): Record<string, string> | undefined {
  return entityFieldsRegistry[slug]
}
`
  const outPath = path.join(generatedRoot, 'entity-fields-registry.ts')
  ensureDir(outPath)
  fs.writeFileSync(outPath, src)
}

async function scan() {
  const entries = loadEnabledModules()

  const consolidated: Record<string, any> = {}
  const grouped: Record<GroupKey, Record<string, any>> = {}
  const modulesDict: Record<string, string> = {}
  const groupedModulesDict: Record<GroupKey, Record<string, string>> = {}

  const fieldsByGroup: Record<GroupKey, Record<string, EntityFieldMap>> = {}

  for (const entry of entries) {
    const modId = entry.id
    const roots = moduleFsRoots(entry)
    const imps = moduleImportBase(entry)
    const group: GroupKey = (entry.from as GroupKey) || '@open-mercato/core'

    // Locate entities definition file (prefer app override)
    const appData = path.join(roots.appBase, 'data')
    const pkgData = path.join(roots.pkgBase, 'data')
    const appDb = path.join(roots.appBase, 'db')
    const pkgDb = path.join(roots.pkgBase, 'db')
    const bases = [appData, pkgData, appDb, pkgDb]
    const candidates = ['entities.override.ts', 'entities.ts', 'schema.ts']
    let importPath: string | null = null
    let filePath: string | null = null
    for (const base of bases) {
      for (const f of candidates) {
        const p = path.join(base, f)
        if (fs.existsSync(p)) {
          const fromApp = base.startsWith(roots.appBase)
          const sub = path.basename(base) // 'data' | 'db'
          importPath = `${fromApp ? imps.appBase : imps.pkgBase}/${sub}/${f.replace(/\.ts$/, '')}`
          filePath = p
          break
        }
      }
      if (importPath) break
    }
    // No entities file found → still register module id
    if (!importPath) {
      modulesDict[modId] = modId
      groupedModulesDict[group] = groupedModulesDict[group] || {}
      groupedModulesDict[group]![modId] = modId
      continue
    }

    // Dynamically import the entities module to list exported classes
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import(importPath)
    const exportNames = Object.keys(mod)
    const entityNames = exportNames
      .filter((k) => typeof (mod as any)[k] === 'function')
      .map((k) => toSnake(k))
      .filter((k, idx, arr) => arr.indexOf(k) === idx)

    // Build dictionaries
    modulesDict[modId] = modId
    groupedModulesDict[group] = groupedModulesDict[group] || {}
    groupedModulesDict[group]![modId] = modId

    consolidated[modId] = consolidated[modId] || {}
    grouped[group] = grouped[group] || {}
    ;(grouped[group] as any)[modId] = (grouped[group] as any)[modId] || {}
    for (const en of entityNames) {
      consolidated[modId][en] = `${modId}:${en}`
      ;(grouped[group] as any)[modId][en] = `${modId}:${en}`
    }

    if (filePath) {
      const originalClassNames = exportNames.filter((k) => typeof (mod as any)[k] === 'function')
      const entityFieldMap = parseEntityFieldsFromFile(filePath, originalClassNames)
      fieldsByGroup[group] = fieldsByGroup[group] || {}
      fieldsByGroup[group]![modId] = entityFieldMap
    }
  }

  // Write consolidated output
  const consolidatedSrc = `// AUTO-GENERATED by scripts/generate-entity-ids.ts
export const M = ${JSON.stringify(modulesDict, null, 2)} as const
export const E = ${JSON.stringify(consolidated, null, 2)} as const
export type KnownModuleId = keyof typeof M
export type KnownEntities = typeof E
`
  
  // Check if content has changed
  const newChecksum = calculateChecksum(consolidatedSrc)
  let shouldWrite = true
  
  if (fs.existsSync(checksumFile)) {
    const existingChecksum = fs.readFileSync(checksumFile, 'utf8').trim()
    if (existingChecksum === newChecksum) {
      shouldWrite = false
    }
  }
  
  if (shouldWrite) {
    ensureDir(OUT_CONSOLIDATED)
    fs.writeFileSync(OUT_CONSOLIDATED, consolidatedSrc)
    fs.writeFileSync(checksumFile, newChecksum)
    console.log('✅ Generated', path.relative(process.cwd(), OUT_CONSOLIDATED))
  }

  // Write per-group outputs
  const groups = Object.keys(grouped) as GroupKey[]
  for (const g of groups) {
    const isApp = g === '@app'
    const out = isApp
      ? path.resolve('generated/entities.ids.generated.ts')
      : path.join(pkgRootFor(g), 'generated', 'entities.ids.generated.ts')
    const src = `// AUTO-GENERATED by scripts/generate-entity-ids.ts
export const M = ${JSON.stringify(groupedModulesDict[g] || {}, null, 2)} as const
export const E = ${JSON.stringify(grouped[g] || {}, null, 2)} as const
export type KnownModuleId = keyof typeof M
export type KnownEntities = typeof E
`
    ensureDir(out)
    fs.writeFileSync(out, src)
    const fieldsRoot = isApp
      ? path.resolve('generated/entities')
      : path.join(pkgRootFor(g), 'generated', 'entities')
    const fieldsByModule = fieldsByGroup[g] || {}
    const combined: EntityFieldMap = {}
    for (const mId of Object.keys(fieldsByModule)) {
      const mMap = fieldsByModule[mId]
      for (const [entity, fields] of Object.entries(mMap)) {
        combined[entity] = Array.from(new Set([...(combined[entity] || []), ...fields]))
      }
    }
    writePerEntityFieldFiles(fieldsRoot, combined)

    // Generate static entity fields registry for Turbopack compatibility
    const generatedRoot = isApp ? path.resolve('generated') : path.join(pkgRootFor(g), 'generated')
    writeEntityFieldsRegistry(generatedRoot, combined)
  }

  const combinedAll: EntityFieldMap = {}
  for (const groupFields of Object.values(fieldsByGroup)) {
    for (const mMap of Object.values(groupFields)) {
      for (const [entity, fields] of Object.entries(mMap)) {
        combinedAll[entity] = Array.from(new Set([...(combinedAll[entity] || []), ...fields]))
      }
    }
  }
  writePerEntityFieldFiles(path.resolve('generated/entities'), combinedAll)
  writeEntityFieldsRegistry(path.resolve('generated'), combinedAll)
}

scan().then(() => {
  // Only log if something was actually generated
}).catch((e) => {
  console.error('Failed to generate entity ids:', e)
  process.exit(1)
})
