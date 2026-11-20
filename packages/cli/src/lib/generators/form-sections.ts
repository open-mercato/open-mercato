import fs from 'node:fs'
import { createHash } from 'node:crypto'
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
  leafDefaultProviderIds: readonly string[]
  sinkIds: readonly string[]
  clientHosts: readonly unknown[]
  contributedOverrides: unknown
  derivedRoutes: readonly DerivedRouteDeclaration[]
}

type DerivedMethod = 'POST' | 'PUT' | 'DELETE'
type DerivedRouteDeclaration = {
  index: number
  routePath: string
  hostDescriptorId: string
  operations: readonly ('create' | 'update' | 'delete')[]
}
export type GeneratedDerivedCrudRoute = {
  moduleId: string
  routePath: string
  fileName: string
  methods: DerivedMethod[]
}

const derivedRouteMethods = { create: 'POST', update: 'PUT', delete: 'DELETE' } as const
export const generatedDerivedCrudRouteIndex = 'crud-form-section-derived-routes.generated.json'


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

function importedNamedBinding(source: ts.SourceFile, localName: string): { specifier: string; exported: string } | null {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.importClause?.isTypeOnly) continue
    const names = statement.importClause?.namedBindings
    if (!names || !ts.isNamedImports(names)) continue
    const entry = names.elements.find(({ name, isTypeOnly }) => !isTypeOnly && name.text === localName)
    if (entry) return { specifier: statement.moduleSpecifier.text, exported: (entry.propertyName ?? entry.name).text }
  }
  return null
}

function exportsFactoryBinding(source: ts.SourceFile, factoryName: string, exported: string): boolean {
  const exportedLocals = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause
        || !ts.isNamedExports(statement.exportClause)) continue
    for (const entry of statement.exportClause.elements) {
      if (!entry.isTypeOnly && entry.name.text === exported) exportedLocals.add((entry.propertyName ?? entry.name).text)
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const direct = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    const isBound = (local: string) => Boolean(direct && local === exported) || exportedLocals.has(local)
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      const value = unwrap(declaration.initializer)
      if (ts.isIdentifier(declaration.name) && isBound(declaration.name.text)
          && ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
          && value.expression.text === factoryName && value.name.text === exported) return true
      if (ts.isObjectBindingPattern(declaration.name) && ts.isIdentifier(value) && value.text === factoryName
          && declaration.name.elements.some((entry) => ts.isIdentifier(entry.name) && isBound(entry.name.text)
            && !entry.initializer && (entry.propertyName ?? entry.name).getText() === exported)) return true
    }
  }
  return false
}

function hasIdentityMapper(input: ts.Expression | undefined): boolean {
  if (!input) return true
  const mapper = unwrap(input)
  if (!ts.isArrowFunction(mapper) || mapper.parameters.length !== 1 || ts.isBlock(mapper.body)) return false
  const binding = mapper.parameters[0].name
  if (!ts.isObjectBindingPattern(binding) || binding.elements.length !== 1) return false
  const [entry] = binding.elements
  const body = unwrap(mapper.body)
  return !entry.dotDotDotToken && !entry.initializer && ts.isIdentifier(entry.name)
    && (entry.propertyName ?? entry.name).getText() === 'parsed' && ts.isIdentifier(body) && body.text === entry.name.text
}

function parseDerivedRoutes(
  fields: ReadonlyMap<string, ts.Expression>,
  module: ModuleSource,
  declaration: ResolvedFile,
  source: ts.SourceFile,
  invalid: (reason: string) => never,
): DerivedRouteDeclaration[] {
  return arrayField(fields, 'derivedHosts', invalid).map((entry, index) => {
    const options = fieldsOf(helperArgument(entry, 'defineCrudRouteSectionHost', invalid), invalid)
    const hostDescriptorId = literalValue(options.get('hostDescriptorId'), 'hostDescriptorId', invalid)
    const formOperation = literalValue(options.get('formOperation'), 'formOperation', invalid)
    if (formOperation !== 'create' && formOperation !== 'update') return invalid('derived host requires create or update')
    if (formOperation === 'create' && options.has('delete')) return invalid('derived create host cannot declare delete')
    const groups = arrayField(options, 'sections', invalid)
    if (!groups.length) return invalid('derived host requires a finite group set')
    for (const group of groups) {
      const writes = literalValue(fieldsOf(group, invalid).get('writes'), 'section writes', invalid)
      if (writes !== 'parent' && writes !== 'none') return invalid('derived host group declares a secondary write')
    }
    const routeNode = options.get('route')
    const binding = routeNode && ts.isIdentifier(routeNode) && importedNamedBinding(source, routeNode.text)
    if (!binding || !/^\.\/api(?:\/[A-Za-z0-9_.[\]-]+)*\/route(?:\.[jt]sx?)?$/.test(binding.specifier)) {
      return invalid('derived host route must import the original named makeCrudRoute result from its module API route')
    }
    const relative = binding.specifier.slice(2)
    const routeFile = module.resolve(relative)
    if (!routeFile || routeFile.fromApp !== declaration.fromApp) return invalid('derived host route is missing or shadowed')
    const mirror = routeFile.fromApp ? null : resolveStandaloneSourceMirrorBase(module.roots.pkgBase)
    const mirrorFile = mirror && MODULE_CODE_EXTENSIONS.map((extension) =>
      path.join(mirror, stripModuleCodeExtension(relative) + extension),
    ).find((candidate) => fs.existsSync(candidate))
    const fileName = mirrorFile || routeFile.absolutePath
    const routeSource = ts.createSourceFile(fileName, fs.readFileSync(fileName, 'utf8'), ts.ScriptTarget.Latest, true)
    const routeInitializer = exportedDeclaration(routeSource, binding.exported)
    const routeCall = routeInitializer && unwrap(routeInitializer)
    const factory = routeCall && ts.isCallExpression(routeCall) && ts.isIdentifier(routeCall.expression)
      && importedNamedBinding(routeSource, routeCall.expression.text)
    if (!routeCall || !ts.isCallExpression(routeCall) || routeCall.arguments.length !== 1
        || !factory || factory.exported !== 'makeCrudRoute'
        || !['@open-mercato/shared/lib/crud/factory', '@open-mercato/shared/lib/crud'].includes(factory.specifier)) {
      return invalid('derived host requires a named original makeCrudRoute declaration')
    }
    const routeDeclaration = routeInitializer?.parent
    if (!routeDeclaration || !ts.isVariableDeclaration(routeDeclaration) || !ts.isIdentifier(routeDeclaration.name)
        || !exportsFactoryBinding(routeSource, routeDeclaration.name.text, 'metadata')) {
      return invalid('derived route metadata must come directly from the named factory result')
    }
    const factoryName = routeDeclaration.name.text
    const factoryOptions = fieldsOf(routeCall.arguments[0], invalid)
    const actionNode = factoryOptions.get('actions')
    const metadataNode = factoryOptions.get('metadata')
    if (!actionNode || !metadataNode) return invalid('derived route requires literal factory actions and method metadata')
    if (factoryOptions.has('resolveIdentifiers')) return invalid('derived route declares custom identifier mapping')
    const hooks = factoryOptions.get('hooks')
    if (hooks && [...fieldsOf(hooks, invalid).keys()].some((key) => /^(before|after)(Create|Update|Delete)$/.test(key))) {
      return invalid('derived route declares custom write hooks')
    }
    const actions = fieldsOf(actionNode, invalid)
    const metadata = fieldsOf(metadataNode, invalid)
    const operations: DerivedRouteDeclaration['operations'] = [formOperation, ...(options.has('delete') ? ['delete' as const] : [])]
    for (const operation of operations) {
      const action = actions.get(operation)
      const method = derivedRouteMethods[operation]
      if (!action || !metadata.has(method) || !exportsFactoryBinding(routeSource, factoryName, method)) {
        return invalid(`derived route has no direct ${method} factory export, command or metadata`)
      }
      const command = fieldsOf(action, invalid)
      if (!hasIdentityMapper(command.get('mapInput')) || command.has('metadata')) {
        return invalid(`derived ${method} route requires direct command input without custom metadata`)
      }
      const commandId = literalValue(command.get('commandId'), 'commandId', invalid)
      if (!commandId.endsWith(`.${operation}`)) return invalid(`derived ${method} route command does not match its operation`)
      const methodMetadata = fieldsOf(metadata.get(method)!, invalid)
      if (methodMetadata.get('requireAuth')?.kind !== ts.SyntaxKind.TrueKeyword
          || methodMetadata.has('requireRoles')) {
        return invalid(`derived ${method} route must require authentication`)
      }
      for (const feature of arrayField(methodMetadata, 'requireFeatures', invalid)) literalValue(feature, 'required feature', invalid)
    }
    const configuredPath = metadata.get('path')
    const basePath = configuredPath ? literalValue(configuredPath, 'route path', invalid)
      : `/${[module.modId, ...relative.split('/').slice(1, -1)].join('/')}`
    if (!/^\/(?:[A-Za-z0-9_.-]+|\[[A-Za-z0-9_-]+\])(?:\/(?:[A-Za-z0-9_.-]+|\[[A-Za-z0-9_-]+\]))*$/.test(basePath)) {
      return invalid('derived route path must be a regular named API path')
    }
    return { index, routePath: `${basePath}/section-policy`, hostDescriptorId, operations }
  })
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

  const derivedRoutes = parseDerivedRoutes(fields, module, declaration, source, invalid)
  const runtimes = new Map<string, { roundTripId: string; runtimePath: string }>()
  for (const runtime of arrayField(fields, 'runtimes', invalid)) {
    const properties = fieldsOf(runtime, invalid)
    const { id, roundTripId } = readIdentity(properties, invalid)
    if (runtimes.has(id)) invalid(`duplicate runtime loader id "${id}"`)
    runtimes.set(id, { roundTripId, runtimePath: readRuntimePath(properties.get('load'), declaration, { id, roundTripId }, invalid) })
  }

  const leafDefaultProviderIds = arrayField(fields, 'leafDefaultProviders', invalid).map((entry) => {
    const provider = unwrap(entry)
    if (!ts.isObjectLiteralExpression(provider)) return invalid('expected a leaf default provider object')
    const factProperty = provider.properties.find((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      && property.name.text === 'fact')
    if (!factProperty) return invalid('missing literal leaf default provider fact')
    literalData(factProperty.initializer, invalid)
    return readIdentity(fieldsOf(factProperty.initializer, invalid), invalid).id
  }).sort(compareIds)
  const sinkIds = arrayField(fields, 'sinks', invalid).map((entry) => {
    const call = unwrap(entry)
    const isOutboxBuilder = ts.isCallExpression(call) && ts.isIdentifier(call.expression)
      && call.expression.text === 'defineCrudFormSectionOutboxSink'
    const declaration = unwrap(helperArgument(entry, isOutboxBuilder ? 'defineCrudFormSectionOutboxSink' : 'defineCrudFormSectionSink', invalid))
    if (!ts.isObjectLiteralExpression(declaration)) return invalid('expected a sink declaration object')
    const fact = declaration.properties.find((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      && property.name.text === 'fact')
    if (!fact) return invalid('missing literal sink fact')
    const properties = fieldsOf(fact.initializer, invalid)
    const { id } = readIdentity(properties, invalid)
    literalData(fact.initializer, invalid)
    if (literalValue(properties.get('ownerModuleId'), 'ownerModuleId', invalid) !== module.modId) {
      return invalid(`sink "${id}" must be declared in its owning module`)
    }
    const atomicity = literalValue(properties.get('atomicity'), 'atomicity', invalid)
    const externalDelivery = properties.get('externalDelivery')
    if (atomicity === 'outbox') {
      if (!externalDelivery) return invalid(`outbox sink "${id}" requires a literal externalDelivery contract`)
      const external = fieldsOf(externalDelivery, invalid)
      const maxAttempts = external.get('maxAttempts')
      const attempts = maxAttempts && literalData(maxAttempts, invalid)
      if (external.size !== 5
          || literalValue(external.get('fencing'), 'fencing', invalid) !== 'remote-monotonic-revision/v1'
          || literalValue(external.get('coalesce'), 'coalesce', invalid) !== 'latest-state'
          || !['none', 'read-only'].includes(literalValue(external.get('preCommitValidation'), 'preCommitValidation', invalid))
          || !literalValue(external.get('integrationId'), 'integrationId', invalid)
          || typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 1) {
        return invalid(`outbox sink "${id}" requires the remote-monotonic-revision/v1 fencing contract`)
      }
    } else if (!['host-transaction', 'after-commit'].includes(atomicity) || externalDelivery || isOutboxBuilder) {
      return invalid(`invalid atomicity or externalDelivery for sink "${id}"`)
    }
    return id
  }).sort(compareIds)
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
          const fact = literalData(surface, invalid)
          const derived = derivedRoutes.find(({ hostDescriptorId }) => hostDescriptorId === id)
          if (!derived) return fact
          if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return invalid('expected finite derived host facts')
          return { ...fact, mutationSurfaceIds: derived.operations.map((operation) => `${id}.${operation}`) }
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
    derivedRoutes,
    clientHosts: clientHosts.sort((left, right) => compareIds(left.id, right.id)),
    contributedOverrides: fields.has('contributedOverrides')
      ? literalData(fields.get('contributedOverrides')!, invalid)
      : {},
    leafDefaultProviderIds,
    sinkIds,
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
    ...(modules.some(({ derivedRoutes }) => derivedRoutes.length)
      ? ["import { bindDerivedCrudRouteSectionHosts } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'"] : []),
    '',
    'export const crudFormSectionFactEntries = [',
    ...entries,
    '] as const satisfies readonly CrudFormSectionFactEntry[]',
    '',
    'export const crudFormSectionServerModules = [',
    ...modules.map(({ moduleId, derivedRoutes }, index) => {
      const bindings = derivedRoutes.map((route) => `{ declaration: sections${index}.derivedHosts[${route.index}], route: ${JSON.stringify(route.routePath)} }`)
      const sections = bindings.length ? `bindDerivedCrudRouteSectionHosts(sections${index}, [${bindings.join(', ')}])` : `sections${index}`
      return `  { moduleId: ${JSON.stringify(moduleId)}, sections: ${sections} },`
    }),
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
  const defaultModulesById = new Map<string, string>()
  const sinkModulesById = new Map<string, string>()
  for (const module of modules) {
    for (const id of module.sinkIds) {
      const owner = sinkModulesById.get(id)
      if (owner) throw new Error(`[generate] Duplicate CrudForm section sink id "${id}" in "${owner}" and "${module.moduleId}"`)
      sinkModulesById.set(id, module.moduleId)
    }
    for (const id of module.leafDefaultProviderIds) {
      const owner = defaultModulesById.get(id)
      if (owner) {
        throw new Error(`[generate] Duplicate leaf default provider id "${id}" in "${owner}" and "${module.moduleId}"`)
      }
      defaultModulesById.set(id, module.moduleId)
    }
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

const derivedRouteFilePattern = /^crud-form-section-route-[a-f0-9]{16}\.generated\.ts$/

export function writeDerivedCrudFormSectionRoutes(
  options: Parameters<typeof writeCrudFormSectionRegistries>[0],
): GeneratedDerivedCrudRoute[] {
  const routes = new Map<string, {
    moduleId: string
    importPath: string
    entries: DerivedRouteDeclaration[]
  }>()
  for (const module of options.modules) {
    const source = parseModuleSections(module)
    if (!source) continue
    const hostIds = new Set(source.descriptors.filter(({ kind }) => kind === 'host').map(({ id }) => id))
    const bound = new Set<string>()
    for (const entry of source.derivedRoutes) {
      if (!hostIds.has(entry.hostDescriptorId) || bound.has(entry.hostDescriptorId)) {
        throw new Error(`[generate] Derived CrudForm route requires one matching host fact in "${module.modId}"`)
      }
      bound.add(entry.hostDescriptorId)
      const existing = routes.get(entry.routePath)
      if (existing && existing.moduleId !== module.modId) {
        throw new Error(`[generate] Duplicate derived CrudForm route "${entry.routePath}"`)
      }
      const route = existing ?? { moduleId: module.modId, importPath: source.importPath, entries: [] }
      route.entries.push(entry)
      routes.set(entry.routePath, route)
    }
  }

  const generated: GeneratedDerivedCrudRoute[] = []
  for (const [routePath, { moduleId, importPath, entries }] of [...routes].sort(([left], [right]) => compareIds(left, right))) {
    const suffix = createHash('sha256').update(`${moduleId}:${routePath}`).digest('hex').slice(0, 16)
    const fileName = `crud-form-section-route-${suffix}.generated.ts`
    const methods = [...new Set(entries.flatMap(({ operations }) => operations.map((operation) => derivedRouteMethods[operation])))].sort(compareIds)
    const content = [
      generatedHeader,
      "import { createDerivedCrudFormSectionFacade } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'",
      `import { crudFormSections } from ${JSON.stringify(importPath)}`,
      `const facade = createDerivedCrudFormSectionFacade([${entries.map(({ index }) => `crudFormSections.derivedHosts[${index}]`).join(', ')}], ${JSON.stringify(routePath)}, ${JSON.stringify(methods)})`,
      'export const metadata = facade.metadata',
      'export const openApi = facade.openApi',
      ...methods.map((method) => `export const ${method} = facade.handlers.${method}!`),
      '',
    ].join('\n')
    generated.push({ moduleId, routePath, fileName, methods })
    writeGeneratedFile({
      outFile: path.join(options.outputDir, fileName),
      checksumFile: path.join(options.outputDir, fileName.replace(/\.ts$/, '.checksum')),
      content, structureChecksum: options.structureChecksum, result: options.result, quiet: options.quiet,
    })
  }

  const indexPath = path.join(options.outputDir, generatedDerivedCrudRouteIndex)
  if (generated.length || fs.existsSync(indexPath)) {
    writeGeneratedFile({
      outFile: indexPath,
      checksumFile: indexPath.replace(/\.json$/, '.checksum'),
      content: JSON.stringify(generated, null, 2) + '\n',
      structureChecksum: options.structureChecksum, result: options.result, quiet: options.quiet,
    })
  }
  const current = new Set(generated.map(({ fileName }) => fileName))
  if (fs.existsSync(options.outputDir)) {
    for (const fileName of fs.readdirSync(options.outputDir)) {
      if (!derivedRouteFilePattern.test(fileName) || current.has(fileName)) continue
      fs.rmSync(path.join(options.outputDir, fileName), { force: true })
      fs.rmSync(path.join(options.outputDir, fileName.replace(/\.ts$/, '.checksum')), { force: true })
    }
  }
  return generated
}

export function readDerivedCrudFormSectionRouteIndex(outputDir: string): GeneratedDerivedCrudRoute[] {
  const filePath = path.join(outputDir, generatedDerivedCrudRouteIndex)
  if (!fs.existsSync(filePath)) return []
  const entries: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!Array.isArray(entries)) throw new Error('[generate] Invalid generated derived route index')
  return entries.map((entry: Partial<GeneratedDerivedCrudRoute>) => {
    if (typeof entry.moduleId !== 'string' || typeof entry.routePath !== 'string' || !entry.routePath.endsWith('/section-policy')
        || typeof entry.fileName !== 'string' || !derivedRouteFilePattern.test(entry.fileName)
        || !Array.isArray(entry.methods) || !entry.methods.every((method) => ['POST', 'PUT', 'DELETE'].includes(method))) {
      throw new Error('[generate] Invalid derived route index entry')
    }
    return { moduleId: entry.moduleId, routePath: entry.routePath, fileName: entry.fileName, methods: entry.methods }
  })
}
