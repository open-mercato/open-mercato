import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import { resolveModuleRequirement, type ModuleIdentity } from '@open-mercato/shared/modules/module-locators'
import { writeGeneratedFile, type GeneratorResult } from '../utils'
import {
  MODULE_CODE_EXTENSIONS,
  resolveStandaloneSourceMirrorBase,
  stripModuleCodeExtension,
  type ModuleRoots,
  type ResolvedFile,
} from './scanner'

type ModuleSource = {
  modId: string
  roots: ModuleRoots
  resolve: (relativePath: string) => ResolvedFile | null
}

const factFields = [
  ['host', 'hostFacts'],
  ['contribution', 'contributionFacts'],
] as const

type Descriptor = {
  id: string
  roundTripId: string
  kind: (typeof factFields)[number][0]
  field: (typeof factFields)[number][1]
  index: number
  runtimePath: string
}

type ModuleSections = {
  moduleId: string
  importPath: string
  descriptors: Descriptor[]
  clientHosts: readonly unknown[]
  contributedOverrides: unknown
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    expression = expression.expression
  }
  return expression
}

function exportedDeclaration(source: ts.SourceFile, name: string): ts.Expression | undefined {
  const exportedNames = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || statement.moduleSpecifier || !statement.exportClause) continue
    if (!ts.isNamedExports(statement.exportClause)) continue
    for (const entry of statement.exportClause.elements) {
      if (!entry.isTypeOnly && entry.name.text === name) exportedNames.add((entry.propertyName ?? entry.name).text)
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const direct = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      if ((direct && declaration.name.text === name) || exportedNames.has(declaration.name.text)) return declaration.initializer
    }
  }
  return undefined
}

function fieldsOf(node: ts.Expression, invalid: (reason: string) => never): Map<string, ts.Expression> {
  const literal = unwrap(node)
  if (!ts.isObjectLiteralExpression(literal)) return invalid('expected an object literal')
  const fields = new Map<string, ts.Expression>()
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      return invalid('expected literal property assignments')
    }
    const name = property.name.text
    if (fields.has(name)) return invalid(`duplicate property "${name}"`)
    fields.set(name, property.initializer)
  }
  return fields
}

function literalData(node: ts.Expression, invalid: (reason: string) => never): unknown {
  const value = unwrap(node)
  if (ts.isStringLiteralLike(value)) return value.text
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (value.kind === ts.SyntaxKind.NullKeyword) return null
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(value)) return value.elements.map((element) => literalData(element, invalid))
  if (ts.isObjectLiteralExpression(value)) {
    return Object.fromEntries([...fieldsOf(value, invalid)]
      .map(([key, entry]) => [key, literalData(entry, invalid)]))
  }
  return invalid('expected JSON-serializable client facts')
}

function literalValue(node: ts.Expression | undefined, name: string, invalid: (reason: string) => never): string {
  if (!node) return invalid(`missing literal ${name}`)
  const literal = unwrap(node)
  if (!ts.isStringLiteralLike(literal) || !literal.text) return invalid(`expected a non-empty literal ${name}`)
  return literal.text
}

function readIdentity(fields: ReadonlyMap<string, ts.Expression>, invalid: (reason: string) => never) {
  const id = literalValue(fields.get('id'), 'id', invalid)
  const roundTripId = literalValue(fields.get('roundTripId'), 'roundTripId', invalid)
  const separator = roundTripId.lastIndexOf('@v')
  if (separator < 0 || roundTripId.slice(0, separator) !== id || !/^[1-9][0-9]*$/.test(roundTripId.slice(separator + 2))) {
    return invalid(`roundTripId "${roundTripId}" must be "${id}@v<positive-integer>"`)
  }
  return { id, roundTripId }
}

function arrayField(
  fields: ReadonlyMap<string, ts.Expression>,
  name: string,
  invalid: (reason: string) => never,
): readonly ts.Expression[] {
  const initializer = fields.get(name)
  if (!initializer) return []
  const literal = unwrap(initializer)
  if (!ts.isArrayLiteralExpression(literal)) return invalid(`expected a literal ${name} array`)
  return literal.elements
}

function helperArgument(node: ts.Expression, name: string, invalid: (reason: string) => never): ts.Expression {
  const call = unwrap(node)
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== name || call.arguments.length !== 1) {
    return invalid(`expected ${name} with one argument`)
  }
  return call.arguments[0]
}

function readRuntimePath(
  initializer: ts.Expression | undefined,
  declaration: ResolvedFile,
  expected: { id: string; roundTripId: string },
  invalid: (reason: string) => never,
): string {
  if (!initializer) return invalid('missing runtime loader')
  const arrow = unwrap(helperArgument(initializer, 'lazyCrudFormSectionRuntime', invalid))
  if (!ts.isArrowFunction(arrow) || arrow.parameters.length !== 0 || ts.isBlock(arrow.body)) {
    return invalid('expected a zero-argument arrow returning a literal import()')
  }
  const call = unwrap(arrow.body)
  if (!ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.ImportKeyword || call.arguments.length !== 1) {
    return invalid('expected a literal import()')
  }
  const specifier = literalValue(call.arguments[0], 'runtime import specifier', invalid)
  if (!specifier.startsWith('./') || specifier.includes('\\')) return invalid('expected a module-relative runtime import')
  const relative = stripModuleCodeExtension(path.posix.normalize(specifier))
  if (relative.startsWith('../') || !relative.endsWith('.client')) {
    return invalid(`runtime import "${specifier}" must resolve to a .client file inside the owning module`)
  }
  const base = path.dirname(declaration.absolutePath)
  const runtimeFile = MODULE_CODE_EXTENSIONS
    .map((extension) => path.join(base, `${relative}${extension}`))
    .find((candidate) => fs.existsSync(candidate))
  if (!runtimeFile) return invalid(`runtime import "${specifier}" is missing from the owning module`)
  const runtimeSource = ts.createSourceFile(runtimeFile, fs.readFileSync(runtimeFile, 'utf8'), ts.ScriptTarget.Latest, true)
  const runtime = exportedDeclaration(runtimeSource, 'crudFormSectionRuntime')
  if (!runtime) return invalid(`runtime import "${specifier}" must export crudFormSectionRuntime`)
  const actual = readIdentity(fieldsOf(runtime, invalid), invalid)
  if (actual.id !== expected.id || actual.roundTripId !== expected.roundTripId) {
    return invalid(`runtime import "${specifier}" exports "${actual.roundTripId}" but loader declares "${expected.roundTripId}"`)
  }
  const importBase = declaration.importPath.slice(0, declaration.importPath.lastIndexOf('/'))
  return `${importBase}/${relative}`
}

function parseModuleSections(module: ModuleSource): ModuleSections | null {
  const declaration = module.resolve('form-sections.ts')
  if (!declaration) return null
  const mirror = declaration.fromApp ? null : resolveStandaloneSourceMirrorBase(module.roots.pkgBase)
  const sourceFile = mirror && fs.existsSync(path.join(mirror, 'form-sections.ts'))
    ? path.join(mirror, 'form-sections.ts')
    : declaration.absolutePath
  const source = ts.createSourceFile(sourceFile, fs.readFileSync(sourceFile, 'utf8'), ts.ScriptTarget.Latest, true)
  const invalid = (reason: string): never => {
    throw new Error(`[generate] form-sections for "${module.modId}" (${sourceFile}): ${reason}`)
  }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    if (/^(?:react(?:-dom)?|next)(?:\/|$)/.test(specifier) || /(?:\.client(?:\.[jt]sx?)?|\/page(?:\.[jt]sx?)?)$/.test(specifier)) {
      invalid(`server declaration statically imports "${specifier}"`)
    }
  }
  const initializer = exportedDeclaration(source, 'crudFormSections')
  if (!initializer) return invalid('expected a named crudFormSections declaration')
  const fields = fieldsOf(helperArgument(initializer, 'defineCrudFormSections', invalid), invalid)

  const runtimes = new Map<string, { roundTripId: string; runtimePath: string }>()
  for (const runtime of arrayField(fields, 'runtimes', invalid)) {
    const properties = fieldsOf(runtime, invalid)
    const { id, roundTripId } = readIdentity(properties, invalid)
    if (runtimes.has(id)) invalid(`duplicate runtime loader id "${id}"`)
    runtimes.set(id, { roundTripId, runtimePath: readRuntimePath(properties.get('load'), declaration, { id, roundTripId }, invalid) })
  }

  const descriptors: Descriptor[] = []
  const clientHosts: Array<{ id: string; roundTripId: string; hostResourceKind?: string; alternatives: unknown[] }> = []
  const factIds = new Set<string>()
  for (const [kind, field] of factFields) {
    const facts = arrayField(fields, field, invalid)
    for (const [index, fact] of facts.entries()) {
      const properties = fieldsOf(fact, invalid)
      const { id, roundTripId } = readIdentity(properties, invalid)
      if (kind === 'host') {
        const alternatives = arrayField(properties, 'alternatives', invalid).map((entry) => {
          const surface = fieldsOf(entry, invalid).get('surface')
          if (!surface) return invalid('missing finite surface alternative')
          return literalData(surface, invalid)
        })
        const hostResourceKind = properties.has('hostResourceKind')
          ? literalValue(properties.get('hostResourceKind'), 'hostResourceKind', invalid)
          : undefined
        if (alternatives.length && !hostResourceKind) return invalid('host alternatives require a hostResourceKind')
        clientHosts.push({ id, roundTripId, hostResourceKind, alternatives })
      }
      if (factIds.has(id)) invalid(`duplicate fact id "${id}"`)
      factIds.add(id)
      const runtime = runtimes.get(id)
      if (!runtime) return invalid(`fact "${id}" has no matching runtime loader`)
      if (runtime.roundTripId !== roundTripId) {
        invalid(`fact and runtime roundTripId differ for "${id}"`)
      }
      descriptors.push({ id, roundTripId, kind, field, index, runtimePath: runtime.runtimePath })
    }
  }
  for (const id of runtimes.keys()) {
    if (!factIds.has(id)) invalid(`runtime loader "${id}" has no matching fact`)
  }
  return {
    moduleId: module.modId,
    importPath: declaration.importPath,
    clientHosts: clientHosts.sort((left, right) => compareIds(left.id, right.id)),
    contributedOverrides: fields.has('contributedOverrides')
      ? literalData(fields.get('contributedOverrides')!, invalid)
      : {},
    descriptors: descriptors.sort((left, right) => compareIds(left.id, right.id)),
  }
}

function orderedSectionModules(
  sections: ReadonlyMap<string, ModuleSections>,
  identities: readonly ModuleIdentity[],
  requiresByModule: ReadonlyMap<string, readonly string[]>,
): ModuleSections[] {
  const done = new Set<string>()
  const visiting = new Set<string>()
  const ordered: ModuleSections[] = []
  function visit(moduleId: string): void {
    if (done.has(moduleId)) return
    if (visiting.has(moduleId)) {
      throw new Error(`[generate] Cannot order form-sections through a module dependency cycle at "${moduleId}"`)
    }
    visiting.add(moduleId)
    const dependencies = (requiresByModule.get(moduleId) ?? [])
      .map((requirement) => resolveModuleRequirement(requirement, identities))
      .filter((dependency): dependency is string => dependency !== undefined)
      .sort(compareIds)
    for (const dependency of dependencies) visit(dependency)
    visiting.delete(moduleId)
    done.add(moduleId)
    const module = sections.get(moduleId)
    if (module) ordered.push(module)
  }
  const sectionModules = [...sections.values()].sort((left, right) => compareIds(left.importPath, right.importPath))
  for (const module of sectionModules) visit(module.moduleId)
  return ordered
}

const generatedHeader = '// Auto-generated by yarn generate. Do not edit.'

function renderFactRegistry(modules: readonly ModuleSections[]): string {
  const imports = modules.map(({ importPath }, index) =>
    `import { crudFormSections as sections${index} } from ${JSON.stringify(importPath)}`,
  )
  const entries = modules.flatMap(({ moduleId, descriptors }, index) => descriptors.map((descriptor) =>
    `  { kind: ${JSON.stringify(descriptor.kind)}, moduleId: ${JSON.stringify(moduleId)}, fact: sections${index}.${descriptor.field}[${descriptor.index}] },`,
  ))
  return [
    generatedHeader,
    "import type { CrudFormSectionFactEntry, CrudFormSectionServerModule } from '@open-mercato/shared/modules/form-sections'",
    ...imports,
    '',
    'export const crudFormSectionFactEntries = [',
    ...entries,
    '] as const satisfies readonly CrudFormSectionFactEntry[]',
    '',
    'export const crudFormSectionServerModules = [',
    ...modules.map(({ moduleId }, index) => `  { moduleId: ${JSON.stringify(moduleId)}, sections: sections${index} },`),
    '] as const satisfies readonly CrudFormSectionServerModule[]',
    '',
  ].join('\n')
}

function renderRuntimeRegistry(modules: readonly ModuleSections[]): string {
  const entries = modules.flatMap(({ moduleId, descriptors }) => descriptors.map(({ id, roundTripId, kind, runtimePath }) =>
    `  { id: ${JSON.stringify(id)}, roundTripId: ${JSON.stringify(roundTripId)}, kind: ${JSON.stringify(kind)}, moduleId: ${JSON.stringify(moduleId)}, load: () => import(${JSON.stringify(runtimePath)}) },`,
  ))
  return [
    generatedHeader,
    "import type { CrudFormSectionClientHostFact, CrudFormSectionRuntimeEntry } from '@open-mercato/shared/modules/form-sections'",
    "import type { FormSectionOverridesMap } from '@open-mercato/shared/modules/overrides'",
    '',
    `export const crudFormSectionClientHostFacts = ${JSON.stringify(modules.flatMap((module) => module.clientHosts), null, 2)} as const satisfies readonly CrudFormSectionClientHostFact[]`,
    `export const crudFormSectionContributedOverrides = ${JSON.stringify(Object.assign({}, ...modules.map((module) => module.contributedOverrides)), null, 2)} as const satisfies Readonly<FormSectionOverridesMap>`,
    '',
    'export const crudFormSectionRuntimeEntries: readonly CrudFormSectionRuntimeEntry[] = [',
    ...entries,
    ']',
    '',
    'const runtimesById = new Map(crudFormSectionRuntimeEntries.map((entry) => [entry.id, entry]))',
    '',
    'export function getCrudFormSectionRuntime(id: string): CrudFormSectionRuntimeEntry | undefined {',
    '  return runtimesById.get(id)',
    '}',
    '',
  ].join('\n')
}

export function writeCrudFormSectionRegistries(options: {
  modules: readonly ModuleSource[]
  identities: readonly ModuleIdentity[]
  requiresByModule: ReadonlyMap<string, readonly string[]>
  outputDir: string
  structureChecksum: string
  result: GeneratorResult
  quiet: boolean
}): void {
  const sections = new Map<string, ModuleSections>()
  for (const module of options.modules) {
    const declaration = parseModuleSections(module)
    if (declaration) sections.set(module.modId, declaration)
  }
  const modules = orderedSectionModules(sections, options.identities, options.requiresByModule)
  const modulesById = new Map<string, string>()
  for (const module of modules) {
    for (const { id } of module.descriptors) {
      const owner = modulesById.get(id)
      if (owner) {
        throw new Error(`[generate] Duplicate form-sections descriptor id "${id}" in "${owner}" and "${module.moduleId}"`)
      }
      modulesById.set(id, module.moduleId)
    }
  }

  const outputs = [
    ['crud-form-section-facts', renderFactRegistry(modules)],
    ['crud-form-section-runtime', renderRuntimeRegistry(modules)],
  ]
  for (const [name, content] of outputs) {
    writeGeneratedFile({
      outFile: path.join(options.outputDir, `${name}.generated.ts`),
      checksumFile: path.join(options.outputDir, `${name}.generated.checksum`),
      content,
      structureChecksum: options.structureChecksum,
      result: options.result,
      quiet: options.quiet,
    })
  }
}
