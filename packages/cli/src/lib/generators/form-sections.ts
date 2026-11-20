import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript-js'
import { resolveModuleRequirement, type ModuleIdentity } from '@open-mercato/shared/modules/module-locators'
import {
  crudFormSectionClientMutationFactSchema, crudSectionOperationMethods as derivedRouteMethods,
  derivedCrudFormSectionClientMutationFact, parseCrudFormSectionClientMutationFacts,
} from '@open-mercato/shared/lib/crud/form-sections/client-mutation-facts'
import type { CrudFormSectionClientHostFact } from '@open-mercato/shared/modules/form-sections'
import type { FormSectionOverridesMap } from '@open-mercato/shared/modules/overrides'
import { writeGeneratedFile, type GeneratorResult } from '../utils'
import { compileCrudFormSectionExtensions, type CompilerModule, type CompiledSectionExtensions } from './form-section-extension-compiler'
import { parseSectionExtensionSources } from './form-section-extension-source'
import { arrayField, exportedDeclaration, fieldsOf, helperArgument, literalData, literalValue, readIdentity, readSectionRuntimeFields, unwrap } from './form-section-ast'
import { hashHandwrittenSectionRuntime, planHandwrittenSectionRevisionWrite } from './form-section-runtime-revisions'
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
  formSectionOverrides?: Readonly<FormSectionOverridesMap>
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

type ModuleSections = CompilerModule & {
  hasHandwrittenSections: boolean
  descriptors: Descriptor[]
  leafDefaultProviderIds: readonly string[]
  sinkIds: readonly string[]
  derivedRoutes: readonly DerivedRouteDeclaration[]
  revisionWrite: ReturnType<typeof planHandwrittenSectionRevisionWrite>
}

type DerivedMethod = 'POST' | 'PUT' | 'DELETE'
type DerivedRouteDeclaration = {
  index: number
  routePath: string
  hostDescriptorId: string
  operations: readonly ('create' | 'update' | 'delete')[]
  versioned: boolean
}
export type GeneratedDerivedCrudRoute = {
  moduleId: string
  routePath: string
  fileName: string
  methods: DerivedMethod[]
}

export const generatedDerivedCrudRouteIndex = 'crud-form-section-derived-routes.generated.json'


function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function readRuntimePath(
  initializer: ts.Expression | undefined,
  declaration: ResolvedFile,
  declarationSourcePath: string,
  expected: { id: string; roundTripId: string },
  invalid: (reason: string) => never,
): { runtimePath: string; source: ts.SourceFile } {
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
  const readRuntime = (declarationPath: string) => {
    const runtimeFile = MODULE_CODE_EXTENSIONS
      .map((extension) => path.join(path.dirname(declarationPath), `${relative}${extension}`))
      .find((candidate) => fs.existsSync(candidate))
    if (!runtimeFile) return invalid(`runtime import "${specifier}" is missing from the owning module`)
    const source = ts.createSourceFile(runtimeFile, fs.readFileSync(runtimeFile, 'utf8'), ts.ScriptTarget.Latest, true)
    const runtime = exportedDeclaration(source, 'crudFormSectionRuntime')
    if (!runtime) return invalid(`runtime import "${specifier}" must export crudFormSectionRuntime`)
    const runtimeValue = unwrap(runtime)
    const literal = ts.isCallExpression(runtimeValue)
      ? helperArgument(runtimeValue,
        ts.isIdentifier(runtimeValue.expression) && runtimeValue.expression.text === 'defineCrudFormFieldGranularSection'
          ? 'defineCrudFormFieldGranularSection' : 'defineCrudFormSectionRuntime', invalid) : runtimeValue
    const actual = readIdentity(fieldsOf(literal, invalid), invalid)
    if (actual.id !== expected.id || actual.roundTripId !== expected.roundTripId) {
      return invalid(`runtime import "${specifier}" exports "${actual.roundTripId}" but loader declares "${expected.roundTripId}"`)
    }
    return source
  }
  const source = readRuntime(declarationSourcePath)
  if (declarationSourcePath !== declaration.absolutePath) readRuntime(declaration.absolutePath)
  const importBase = declaration.importPath.slice(0, declaration.importPath.lastIndexOf('/'))
  return { runtimePath: `${importBase}/${relative}`, source }
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
    const versioned = options.has('expectedVersionField')
    if (versioned) literalValue(options.get('expectedVersionField'), 'expectedVersionField', invalid)
    return { index, routePath: `${basePath}/section-policy`, hostDescriptorId, operations, versioned }
  })
}

function parseModuleSections(module: ModuleSource, checkRevisions = false): ModuleSections | null {
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
  const extensionExport = exportedDeclaration(source, 'crudFormExtensions')
  if (!initializer && !extensionExport) return invalid('expected a named crudFormSections or crudFormExtensions declaration')
  const moduleBase = path.dirname(sourceFile)
  const extensions = parseSectionExtensionSources(extensionExport, moduleBase, declaration.importPath, invalid)
  const fields = initializer ? fieldsOf(helperArgument(initializer, 'defineCrudFormSections', invalid), invalid) : new Map<string, ts.Expression>()

  const derivedRoutes = parseDerivedRoutes(fields, module, declaration, source, invalid)
  const runtimes = new Map<string, { roundTripId: string; runtimePath: string; source: ts.SourceFile }>()
  for (const runtime of arrayField(fields, 'runtimes', invalid)) {
    const properties = fieldsOf(runtime, invalid)
    const { id, roundTripId } = readIdentity(properties, invalid)
    if (runtimes.has(id)) invalid(`duplicate runtime loader id "${id}"`)
    runtimes.set(id, { roundTripId, ...readRuntimePath(properties.get('load'), declaration, sourceFile, { id, roundTripId }, invalid) })
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
      const target = literalValue(properties.get('targetEntityId'), 'targetEntityId', invalid)
      const contract = literalValue(external.get('contractId'), 'contractId', invalid)
      if (!contract.startsWith(`${target}@v`) || !/^[1-9][0-9]*$/.test(contract.slice(target.length + 2))) {
        return invalid(`outbox sink "${id}" requires contractId "${target}@v<positive-integer>"`)
      }
      if (external.size !== 6
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
  const primitiveContributions: CompilerModule['primitiveContributions'][number][] = []
  const authoredSource = !moduleBase.split(path.sep).includes('node_modules')
    && (declaration.fromApp || !moduleBase.split(path.sep).includes('dist'))
  const revisions: Array<{ id: string; roundTripId: string; sourceHash: string }> = []
  const clientHosts: CrudFormSectionClientHostFact[] = []
  const factIds = new Set<string>()
  for (const [kind, field] of factFields) {
    const facts = arrayField(fields, field, invalid)
    for (const [index, fact] of facts.entries()) {
      const properties = fieldsOf(fact, invalid)
      const { id, roundTripId } = readIdentity(properties, invalid)
      if (kind === 'host') {
        const hostResourceKind = properties.has('hostResourceKind')
          ? literalValue(properties.get('hostResourceKind'), 'hostResourceKind', invalid)
          : undefined
        const alternatives = arrayField(properties, 'alternatives', invalid).map((entry) => {
          const alternative = fieldsOf(entry, invalid)
          const surface = alternative.get('surface')
          if (!surface) return invalid('missing finite surface alternative')
          const fact = literalData(surface, invalid)
          if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return invalid('expected finite surface facts')
          const derived = derivedRoutes.find(({ hostDescriptorId }) => hostDescriptorId === id)
          if (Object.hasOwn(fact, 'clientMutationSurfaces')) return invalid('client mutation surface projection is generated')
          if ('allowNoopSubmit' in fact && typeof fact.allowNoopSubmit !== 'boolean') return invalid('allowNoopSubmit must be a boolean')
          const authoredIds = (fact as { mutationSurfaceIds?: unknown }).mutationSurfaceIds
          if (!Array.isArray(authoredIds) || authoredIds.some((surfaceId) => typeof surfaceId !== 'string')) {
            return invalid('mutationSurfaceIds must be a literal ID array')
          }
          const rows = derived ? derived.operations.map((operation) => derivedCrudFormSectionClientMutationFact({
            operation, hostDescriptorId: id, route: derived.routePath,
            versioned: derived.versioned, resourceKind: hostResourceKind ?? '',
          })) : arrayField(alternative, 'mutationSurfaces', invalid).map((mutation) => {
            const declaration = fieldsOf(mutation, invalid)
            return Object.fromEntries(Object.keys(crudFormSectionClientMutationFactSchema.shape).flatMap((key) => {
              const value = declaration.get(key)
              return value ? [[key, literalData(value, invalid)]] : []
            }))
          })
          const mutationSurfaceIds = derived ? derived.operations.map((operation) => `${id}.${operation}`) : authoredIds
          const clientMutationSurfaces = parseCrudFormSectionClientMutationFacts(mutationSurfaceIds, rows)
          if (!clientMutationSurfaces || clientMutationSurfaces.some((row) => row.hostResourceKind !== hostResourceKind)) {
            return invalid('mutation surface projection does not match its host alternative')
          }
          return {
            ...fact, mutationSurfaceIds,
            ...(clientMutationSurfaces.length ? { clientMutationSurfaces } : {}),
          }
        })
        if (alternatives.length && !hostResourceKind) return invalid('host alternatives require a hostResourceKind')
        clientHosts.push({ id, roundTripId, hostResourceKind, alternatives: alternatives as unknown as CrudFormSectionClientHostFact['alternatives'] })
      }
      const addressNode = properties.get('address')
      const operationNode = properties.get('operation')
      if (kind === 'contribution' && addressNode && operationNode && ts.isObjectLiteralExpression(unwrap(addressNode))) {
        const operation = unwrap(operationNode)
        const literalAddress = unwrap(addressNode) as ts.ObjectLiteralExpression
        const address = Object.fromEntries(literalAddress.properties.flatMap((property) => {
          if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name))) return []
          const value = unwrap(property.initializer)
          return ts.isStringLiteralLike(value) ? [[property.name.text, value.text]] : []
        }))
        const { hostId, formVariant, formOperation, sectionId } = address
        if (hostId && formVariant && sectionId && (formOperation === 'create' || formOperation === 'update')
            && ts.isStringLiteralLike(operation) && (operation.text === 'add' || operation.text === 'replace' || operation.text === 'hide')) {
          primitiveContributions.push({ id, address: { hostId, formVariant, formOperation, sectionId }, operation: operation.text })
        }
      }
      if (factIds.has(id)) invalid(`duplicate fact id "${id}"`)
      factIds.add(id)
      const runtime = runtimes.get(id)
      if (!runtime) return invalid(`fact "${id}" has no matching runtime loader`)
      if (runtime.roundTripId !== roundTripId) {
        invalid(`fact and runtime roundTripId differ for "${id}"`)
      }
      descriptors.push({ id, roundTripId, kind, field, index, runtimePath: runtime.runtimePath })
      if (checkRevisions && authoredSource) {
        revisions.push({ id, roundTripId, sourceHash: hashHandwrittenSectionRuntime(runtime.source, fact, moduleBase) })
      }
    }
  }
  for (const id of runtimes.keys()) {
    if (!factIds.has(id)) invalid(`runtime loader "${id}" has no matching fact`)
  }
  return {
    moduleId: module.modId,
    importPath: declaration.importPath,
    hasHandwrittenSections: Boolean(initializer),
    sourceBase: moduleBase,
    authoredSource,
    extensionSources: extensions,
    runtimeSources: runtimes,
    primitiveContributions,
    derivedRoutes,
    clientHosts: clientHosts.sort((left, right) => compareIds(left.id, right.id)),
    contributedOverrides: fields.has('contributedOverrides')
      ? literalData(fields.get('contributedOverrides')!, invalid) as FormSectionOverridesMap
      : {},
    leafDefaultProviderIds,
    sinkIds,
    revisionWrite: planHandwrittenSectionRevisionWrite(moduleBase, revisions, invalid),
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

function renderFactRegistry(modules: readonly ModuleSections[], compiled: CompiledSectionExtensions): string {
  const moduleIndexes = new Map(modules.map(({ moduleId }, index) => [moduleId, index]))
  const imports = modules.flatMap(({ importPath, hasHandwrittenSections, extensionSources }, index) => [
    ...(hasHandwrittenSections ? [`import { crudFormSections as sections${index} } from ${JSON.stringify(importPath)}`] : []),
    ...(extensionSources.length ? [`import { crudFormExtensions as extensions${index} } from ${JSON.stringify(importPath)}`] : []),
  ])
  const authoredSection = ({ module, extension, change }: {
    module: CompilerModule; extension: CompilerModule['extensionSources'][number]; change: CompilerModule['extensionSources'][number]['changes'][number]
  }) => `extensions${moduleIndexes.get(module.moduleId)}[${extension.index}].sections[${JSON.stringify(change.id)}]`
  const compiledDeclarations = modules.flatMap(({ moduleId }, index) => {
    const candidates = compiled.contributionsByModule.get(moduleId)
    if (!candidates?.length) return []
    const lines = candidates.map(({ contribution, fields, defaults, sinks }) => {
      const compiledFields = fields.flatMap(({ field, authored, payloadPath }) => {
        if (!payloadPath || (!field.server && !field.rules.some(({ enforce }) => enforce === 'client-and-server'))) return []
        const source = `${authoredSection(authored)}.options.fields[${JSON.stringify(field.id)}].${field.operation === 'add' ? 'definition' : 'patch'}`
        const data = JSON.stringify({ fieldId: field.id, payloadPath, rules: field.rules })
        return [`{ ...${data}${field.server ? `, server: ${source}.validate.server` : ''} }`]
      })
      function fieldStore({ field, authored, payloadPath }: (typeof fields)[number]): string {
        const source = authoredSection(authored)
        if (field.store?.fieldOverride) return `${source}.options.fields[${JSON.stringify(field.id)}].definition.store`
        if (authored.change.operation === 'add' && field.store?.kind !== 'customField') return `${source}.options.store`
        return `{ kind: 'customField', key: ${JSON.stringify(payloadPath?.slice('customFields.'.length))} }`
      }
      const stores = fields.flatMap((item) => {
        const { field, authored, payloadPath } = item
        if (!payloadPath || !field.store) return []
        const data = JSON.stringify({ ownerModuleId: authored.module.moduleId, fieldId: field.id, payloadPath })
        return [`{ ...${data}, store: ${fieldStore(item)} }`]
      })
      const sinkAssociations = sinks.map(({ fields: owned, ...keys }) => {
        const [{ authored }] = owned
        const plan = { ...keys, ownerModuleId: authored.module.moduleId, payloadPaths: owned.map(({ payloadPath }) => payloadPath!) }
        return `{ ...${JSON.stringify(plan)}, store: ${fieldStore(owned[0])} }`
      })
      const providers = defaults.map(({ owner, id, payloadPath, readsPayloadPaths }) => {
        const { hostId, formVariant, formOperation } = contribution.address
        const fact = { id, roundTripId: `${id}@v${contribution.roundTripId.split('@v')[1]}`, hostId, formVariant, formOperation, payloadPath, readsPayloadPaths }
        return `{ fact: ${JSON.stringify(fact)}, resolve: extensions${moduleIndexes.get(owner.module.moduleId)}[${owner.extension.index}].defaults[${JSON.stringify(payloadPath)}] }`
      })
      return `  { contribution: ${JSON.stringify(contribution)}, fieldRules: [${compiledFields.join(', ')}], defaults: [${providers.join(', ')}], stores: [${stores.join(', ')}], sinkAssociations: [${sinkAssociations.join(', ')}] },`
    })
    const overrides = Object.fromEntries(Object.entries(compiled.fallbacks).filter(([, override]) => candidates.some(({ id }) => id === override?.contributionId)))
    return [`const compiled${index} = [`, ...lines, '] as const satisfies readonly CompiledCrudFormContribution[]',
      `const compiledOverrides${index} = ${JSON.stringify(overrides)} as const`]
  })
  const entries = modules.flatMap(({ moduleId, descriptors }, index) => [
    ...descriptors.map((descriptor) =>
      `  { kind: ${JSON.stringify(descriptor.kind)}, moduleId: ${JSON.stringify(moduleId)}, fact: sections${index}.${descriptor.field}[${descriptor.index}] },`,
    ),
    ...(compiled.contributionsByModule.get(moduleId) ?? []).map((_, contribution) =>
      `  { kind: "contribution", moduleId: ${JSON.stringify(moduleId)}, fact: compiled${index}[${contribution}].contribution },`),
  ])
  return [
    generatedHeader,
    "import type { CrudFormSectionFactEntry, CrudFormSectionServerModule } from '@open-mercato/shared/modules/form-sections'",
    ...imports,
    ...(compiledDeclarations.length ? [
      "import { bindCompiledCrudFormAlternatives, bindCompiledCrudFormContributions, type CompiledCrudFormContribution } from '@open-mercato/shared/lib/crud/form-sections/compiled-extensions'",
    ] : []),
    ...(modules.some(({ derivedRoutes }) => derivedRoutes.length)
      ? ["import { bindDerivedCrudRouteSectionHosts } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'"] : []),
    '',
    ...compiledDeclarations,
    'export const crudFormSectionFactEntries = [',
    ...entries,
    '] as const satisfies readonly CrudFormSectionFactEntry[]',
    '',
    'export const crudFormSectionServerModules = [',
    ...modules.map(({ moduleId, derivedRoutes, hasHandwrittenSections }, index) => {
      const bindings = derivedRoutes.map((route) => `{ declaration: sections${index}.derivedHosts[${route.index}], route: ${JSON.stringify(route.routePath)} }`)
      const primitive = bindings.length ? `bindDerivedCrudRouteSectionHosts(sections${index}, [${bindings.join(', ')}])`
        : hasHandwrittenSections ? `sections${index}` : '{}'
      const sections = compiled.contributionsByModule.has(moduleId)
        ? `bindCompiledCrudFormContributions(${primitive}, compiled${index}, compiledOverrides${index})` : primitive
      const entry = `{ moduleId: ${JSON.stringify(moduleId)}, sections: ${sections} }`
      const alternatives = compiled.alternativesByModule.get(moduleId)
      return `  ${alternatives?.length ? `bindCompiledCrudFormAlternatives(${entry}, ${JSON.stringify(alternatives)})` : entry},`
    }),
    '] as const satisfies readonly CrudFormSectionServerModule[]',
    '',
  ].join('\n')
}

function renderRuntimeRegistry(modules: readonly ModuleSections[], compiled: CompiledSectionExtensions): string {
  const entries = modules.flatMap(({ moduleId, descriptors }) => [
    ...descriptors.map(({ id, roundTripId, kind, runtimePath }) =>
    `  { id: ${JSON.stringify(id)}, roundTripId: ${JSON.stringify(roundTripId)}, kind: ${JSON.stringify(kind)}, moduleId: ${JSON.stringify(moduleId)}, load: () => import(${JSON.stringify(runtimePath)}) },`,
    ),
    ...(compiled.contributionsByModule.get(moduleId) ?? []).map(({ contribution: { id, roundTripId }, file }) =>
      `  { id: ${JSON.stringify(id)}, roundTripId: ${JSON.stringify(roundTripId)}, kind: "contribution", moduleId: ${JSON.stringify(moduleId)}, load: () => import(${JSON.stringify('./' + stripModuleCodeExtension(file))}) },`),
  ])
  return [
    generatedHeader,
    "import type { CrudFormSectionClientHostFact, CrudFormSectionRuntimeEntry } from '@open-mercato/shared/modules/form-sections'",
    "import type { FormSectionOverridesMap } from '@open-mercato/shared/modules/overrides'",
    '',
    `export const crudFormSectionClientHostFacts = ${JSON.stringify(modules.flatMap((module) => module.clientHosts), null, 2)} as const satisfies readonly CrudFormSectionClientHostFact[]`,
    `export const crudFormSectionContributedOverrides = ${JSON.stringify(Object.assign({}, ...modules.map((module) => module.contributedOverrides), compiled.fallbacks), null, 2)} as const satisfies Readonly<FormSectionOverridesMap>`,
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
    const declaration = parseModuleSections(module, true)
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

  const compiled = compileCrudFormSectionExtensions(modules, Object.assign({}, ...options.modules.map(({ formSectionOverrides }) => formSectionOverrides)))
  for (const [moduleId, candidates] of compiled.contributionsByModule) for (const { id } of candidates) {
    const owner = modulesById.get(id)
    if (owner) throw new Error(`[generate] Duplicate form-sections descriptor id "${id}" in "${owner}" and "${moduleId}"`)
    modulesById.set(id, moduleId)
  }
  const revisions = [...modules.flatMap(({ revisionWrite }) => revisionWrite ? [revisionWrite] : []), ...compiled.revisionWrites]
  for (const revisionWrite of revisions) {
    const temporary = `${revisionWrite.filename}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, revisionWrite.content, { flag: 'wx' })
      fs.renameSync(temporary, revisionWrite.filename)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
    options.result.filesWritten.push(revisionWrite.filename)
  }
  const outputs = [
    ['crud-form-section-facts', renderFactRegistry(modules, compiled)],
    ['crud-form-section-runtime', renderRuntimeRegistry(modules, compiled)],
    ...compiled.runtimeFiles.map(({ name, content }) => [name.slice(0, -'.generated.ts'.length), content]),
  ]
  const retainedRuntimeFiles = new Set(compiled.runtimeFiles.map(({ name }) => name))
  if (fs.existsSync(options.outputDir)) for (const filename of fs.readdirSync(options.outputDir)) {
    if (!/^crud-form-section-extension-[0-9a-f]{20}\.generated\.(?:checksum|ts)$/.test(filename)
        || retainedRuntimeFiles.has(filename.replace(/\.checksum$/, '.ts'))) continue
    fs.rmSync(path.join(options.outputDir, filename), { force: true })
  }
  if (!options.quiet) for (const [moduleId, candidates] of compiled.contributionsByModule) {
    for (const candidate of candidates) {
      const owned = candidate.ownership?.payloadPaths.join(', ') || 'none'
      const stores = candidate.fields.filter(({ field }) => field.store).map(({ field }) => `${field.id}/${field.store!.kind}`).join(', ') || 'none'
      console.log(`[generate] CrudForm extension ${moduleId}/${candidate.id} ${candidate.override.operation}; fields: ${candidate.fields.length}, payload leaves: ${owned}, defaults: ${candidate.defaults.length}, stores: ${stores}, field rules: ${candidate.fields.filter(({ field }) => field.server || field.rules.length).length}`)
    }
  }
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
