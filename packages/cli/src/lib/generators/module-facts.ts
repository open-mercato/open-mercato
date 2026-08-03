import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import type {
  ModuleExtensionContributionFact,
  ModuleExtensionHostFact,
  ModuleExtensionSurfaceFacts,
  ModuleExtensionTargetRef,
} from '@open-mercato/shared/modules/widgets/extension-points'
import { toSnake } from '../utils'
import { extractCommandIdsFromSource } from './module-registry'
import { MODULE_CODE_EXTENSIONS } from './scanner'
import type { ApiRouteInterceptorBridge } from './module-extension-facts'
import {
  assertNoUnresolvedExtensionTargets,
  correlateIncomingExtensions,
  correlateModuleExtensionFacts,
  extractActivationTargetOwners,
  extractKnownApiRouteIds,
  extractKnownCommandIds,
  extractModuleExtensionFacts,
  renderFrameworkExtensionPointsMarkdown,
  withModuleExtensionFactExtractionCache,
} from './module-extension-facts'
import {
  collectModuleOverrideTargets,
  type ModuleOverrideTarget,
  type ModuleOverrideTargetDiagnostic,
} from './module-override-targets'
import { buildFactSourceLookup, type FactSourceLookup } from './module-fact-sources'

export interface ModuleEntityFact {
  id: string
  class: string
  table: string
  editable: boolean
  customFields: boolean
}

export interface ApiRouteAuthRule {
  requireAuth?: boolean
  requireFeatures?: string[]
  requireRoles?: string[]
}

export interface ModuleApiRouteFact {
  path: string
  methods: string[]
  auth: Record<string, ApiRouteAuthRule>
  sourcePath: string | null
}

/**
 * Statically declared page metadata that affects extensibility or access, using the
 * runtime `PageMetadata` contract keys and the same alias precedence as
 * `resolvePageRouteMetadata` (`pageGroup ?? group`, `pageGroupKey ?? groupKey`,
 * `pageOrder ?? order`). Executable guards, icons, titles and translation results are
 * never serialized.
 */
export interface ModulePageMetadata {
  requireAuth?: boolean
  requireCustomerAuth?: boolean
  requireFeatures?: string[]
  requireCustomerFeatures?: string[]
  navHidden?: boolean
  navGroup?: string
  navGroupKey?: string
  navOrder?: number
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
}

export interface ModulePageFact {
  path: string
  sourcePath: string
  /** Companion metadata file (`page.meta.*` / `meta.*`) when runtime reads metadata from one. */
  metadataSourcePath?: string
  metadata?: ModulePageMetadata
}

export interface ModuleCliCommandFact {
  command: string
  sourcePath: string
}

export interface ModuleAiToolFact {
  name: string
  sourcePath: string
}

export interface ModuleAiAgentFact {
  id: string
  sourcePath: string
}

export interface ModuleEventFact {
  id: string
  label?: string
  category: string | null
  entity: string | null
  clientBroadcast?: boolean
  portalBroadcast?: boolean
}

export interface ModuleHostTokens {
  entityIds: string[]
  tableIds: string[]
}

export type ModuleFactSourceRef = {
  sourcePath: string
  exportName?: string
  line?: number
}

export type ModuleFactRef = {
  factSection: string
  factKey: string
}

export type ModuleFactSourceKind =
  | 'module-metadata'
  | 'entity'
  | 'event'
  | 'acl-feature'
  | 'api-route'
  | 'di-registration'
  | 'search'
  | 'vector'
  | 'notification'
  | 'cli-command'
  | 'backend-page'
  | 'frontend-page'
  | 'ai-tool'
  | 'ai-agent'
  | 'ai-extension'
  | 'command'
  | 'subscriber'
  | 'worker'
  | 'page-middleware'
  | 'setup'
  | 'encryption'
  | 'custom-entity'
  | 'integration'
  | 'generator-plugin'
  | 'extension-host'
  | 'extension-contribution'

export type ModuleOwnedContractKind =
  | 'module-metadata'
  | 'command'
  | 'worker'
  | 'page-middleware'
  | 'setup'
  | 'encryption'
  | 'di-registration'
  | 'custom-entity'
  | 'ai-extension'
  | 'generator-plugin'

export type ModuleFactSafeScalar = string | number | boolean | null

export type ModuleOwnedContractFact = {
  kind: ModuleOwnedContractKind
  id: string
  source: ModuleFactSourceRef
  metadata?: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]>
}

export type ModuleOwnedContracts = Partial<
  Record<ModuleOwnedContractKind, ModuleOwnedContractFact[]>
>

/**
 * Provenance pointer into a fact section that already serializes the declaration site.
 * `factKey` is omitted when it equals the owning entry's `id`, which is the common case.
 */
export type ModuleFactIndexRef = {
  factSection: string
  factKey?: string
}

/**
 * One provenance entry per proven `(kind, id)` in the module. Exactly one of `source`
 * (the declaration site, for facts that have no other home in the JSON) or `factRef`
 * (a deterministic pointer into a fact section that already carries the source inline)
 * is present, so a consumer resolves any fact's origin through this single index.
 */
export type ModuleFactSourceEntry = {
  kind: ModuleFactSourceKind
  id: string
  source?: ModuleFactSourceRef
  factRef?: ModuleFactIndexRef
}

export type ModuleFactDiagnostic = {
  code: 'duplicate-source' | 'unresolved-static-contract'
  kind: ModuleFactSourceKind
  id: string
  source?: ModuleFactSourceRef
}

export type ModuleDiRegistrationFact = {
  token: string
  registrationKind: 'function' | 'class' | 'value' | 'alias'
  providerSymbol?: string
  lifetime?: 'singleton' | 'scoped' | 'transient'
  injectionMode?: 'classic' | 'proxy'
  source: ModuleFactSourceRef
}

export interface ModuleFacts {
  module: string
  title: string | null
  description: string | null
  coreVersion: string | null
  sourcePackage: string | null
  sourceVersion: string | null
  sourceRoot: string
  entities: ModuleEntityFact[]
  events: ModuleEventFact[]
  aclFeatures: string[]
  apiRoutes: ModuleApiRouteFact[]
  diTokens: string[]
  searchEntities: string[]
  hostTokens: ModuleHostTokens
  notifications: string[]
  cli: string[]
  backendPages: ModulePageFact[]
  frontendPages: ModulePageFact[]
  cliCommands: ModuleCliCommandFact[]
  aiTools: ModuleAiToolFact[]
  aiAgents: ModuleAiAgentFact[]
  extensionSurfaces?: ModuleExtensionSurfaceFacts
  factSources?: ModuleFactSourceEntry[]
  ownedContracts?: ModuleOwnedContracts
  factDiagnostics?: ModuleFactDiagnostic[]
  overrideTargets?: ModuleOverrideTarget[]
  overrideTargetDiagnostics?: ModuleOverrideTargetDiagnostic[]
  warnings: string[]
}

export interface ExtractModuleFactsOptions {
  moduleId: string
  /**
   * Parent modules directory joined with `moduleId` to locate the module source.
   * Legacy input; prefer the explicit per-module `moduleRoot` for modules that do
   * not live under a single shared root (auto-discovery). One of `moduleRoot` /
   * `coreSrcRoot` must be provided.
   */
  coreSrcRoot?: string
  /** Explicit module source directory. When set it overrides `coreSrcRoot + moduleId`. */
  moduleRoot?: string
  coreVersion?: string | null
  sourcePackage?: string | null
  sourceVersion?: string | null
  registryPath?: string | null
  registrySource?: string | null
}

/** A discovered module and the source directory its facts are extracted from. */
export interface ModuleFactSource {
  moduleId: string
  moduleRoot: string
  from?: string
  packageVersion?: string | null
}

function readSourceFile(filePath: string): ts.SourceFile | null {
  if (!fs.existsSync(filePath)) return null
  const source = fs.readFileSync(filePath, 'utf8')
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2020, true, scriptKind)
}

function resolveConventionFile(baseDir: string, basename: string): string | null {
  for (const extension of ['.ts', '.tsx']) {
    const candidate = path.join(baseDir, `${basename}${extension}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function readStringPropertyInitializer(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteralLike(property.name)
        ? property.name.text
        : undefined
    if (name !== propertyName) continue
    if (ts.isStringLiteralLike(property.initializer)) return property.initializer.text
    return undefined
  }
  return undefined
}

function getClassDecoratorCall(node: ts.ClassDeclaration, decoratorName: string): ts.CallExpression | undefined {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []
  for (const decorator of decorators) {
    const expression = decorator.expression
    if (!ts.isCallExpression(expression)) continue
    if (ts.isIdentifier(expression.expression) && expression.expression.text === decoratorName) {
      return expression
    }
  }
  return undefined
}

function readDecoratorTableName(decoratorCall: ts.CallExpression): string | undefined {
  const firstArgument = decoratorCall.arguments[0]
  if (!firstArgument || !ts.isObjectLiteralExpression(firstArgument)) return undefined
  return readStringPropertyInitializer(firstArgument, 'tableName')
}

function getPropertyDecoratorName(member: ts.PropertyDeclaration): string | undefined {
  const decorators = ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []
  for (const decorator of decorators) {
    const expression = decorator.expression
    if (!ts.isCallExpression(expression)) continue
    const firstArgument = expression.arguments[0]
    if (!firstArgument || !ts.isObjectLiteralExpression(firstArgument)) continue
    const columnName = readStringPropertyInitializer(firstArgument, 'name')
    if (columnName) return columnName
  }
  return undefined
}

function classHasUpdatedAtColumn(node: ts.ClassDeclaration): boolean {
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue
    const propertyName = ts.isIdentifier(member.name)
      ? member.name.text
      : ts.isStringLiteralLike(member.name)
        ? member.name.text
        : undefined
    if (propertyName === 'updatedAt') return true
    if (getPropertyDecoratorName(member) === 'updated_at') return true
  }
  return false
}

function collectCustomFieldEntityIds(ceFilePath: string | null): Set<string> {
  const result = new Set<string>()
  if (!ceFilePath) return result
  const sourceFile = readSourceFile(ceFilePath)
  if (!sourceFile) return result

  const readEntityId = (expression: ts.Expression): string | undefined => {
    const current = unwrapExpression(expression)
    if (ts.isStringLiteralLike(current)) {
      return current.text.includes(':') ? current.text : undefined
    }

    const readAccessPath = (candidate: ts.Expression): string[] | null => {
      const access = unwrapExpression(candidate)
      if (ts.isIdentifier(access)) return [access.text]
      if (ts.isPropertyAccessExpression(access)) {
        const parent = readAccessPath(access.expression)
        return parent ? [...parent, access.name.text] : null
      }
      if (ts.isElementAccessExpression(access) && access.argumentExpression) {
        const parent = readAccessPath(access.expression)
        const key = unwrapExpression(access.argumentExpression)
        return parent && ts.isStringLiteralLike(key) ? [...parent, key.text] : null
      }
      return null
    }

    const accessPath = readAccessPath(current)
    if (accessPath?.length === 3 && accessPath[0] === 'E') {
      return `${accessPath[1]}:${accessPath[2]}`
    }
    return undefined
  }

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const initializer = getObjectPropertyInitializer(node, 'id')
      if (initializer) {
        const id = readEntityId(initializer)
        if (id) result.add(id)
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return result
}

function extractEntities(
  moduleId: string,
  entitiesFilePath: string | null,
  customFieldEntityIds: Set<string>,
): ModuleEntityFact[] {
  const sourceFile = entitiesFilePath ? readSourceFile(entitiesFilePath) : null
  if (!sourceFile) return []

  const facts: ModuleEntityFact[] = []
  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return
    const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!isExported) return
    const entityDecorator = getClassDecoratorCall(node, 'Entity')
    if (!entityDecorator) return

    const className = node.name.text
    const table = readDecoratorTableName(entityDecorator)
    if (!table) return

    const entityId = `${moduleId}:${toSnake(className)}`
    facts.push({
      id: entityId,
      class: className,
      table,
      editable: classHasUpdatedAtColumn(node),
      customFields: customFieldEntityIds.has(entityId),
    })
  })

  return facts
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

function unwrapArrayLiteral(expression: ts.Expression): ts.ArrayLiteralExpression | null {
  const current = unwrapExpression(expression)
  return ts.isArrayLiteralExpression(current) ? current : null
}

function getPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return undefined
  const name = property.name
  if (!name) return undefined
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteralLike(name)) return name.text
  return undefined
}

function getObjectPropertyInitializer(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | undefined {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (getPropertyName(property) === propertyName) return property.initializer
  }
  return undefined
}

function findObjectLiteralDeclaration(
  sourceFile: ts.SourceFile,
  variableName: string,
): ts.ObjectLiteralExpression | null {
  let result: ts.ObjectLiteralExpression | null = null
  const visit = (node: ts.Node): void => {
    if (result) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      const unwrapped = unwrapExpression(node.initializer)
      if (ts.isObjectLiteralExpression(unwrapped)) {
        result = unwrapped
        return
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return result
}

function buildVariableInitializerMap(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!initializers.has(node.name.text)) initializers.set(node.name.text, node.initializer)
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return initializers
}

function resolveToObjectLiteral(
  expression: ts.Expression,
  initializers: Map<string, ts.Expression>,
): ts.ObjectLiteralExpression | null {
  const unwrapped = unwrapExpression(expression)
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped
  if (ts.isIdentifier(unwrapped)) {
    const referenced = initializers.get(unwrapped.text)
    if (referenced) return resolveToObjectLiteral(referenced, initializers)
  }
  return null
}

function resolveToArrayLiteral(
  expression: ts.Expression,
  initializers: Map<string, ts.Expression>,
): ts.ArrayLiteralExpression | null {
  const unwrapped = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped
  if (ts.isIdentifier(unwrapped)) {
    const referenced = initializers.get(unwrapped.text)
    if (referenced) return resolveToArrayLiteral(referenced, initializers)
  }
  return null
}

function findDefaultExportExpression(sourceFile: ts.SourceFile): ts.Expression | null {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) return statement.expression
  }
  return null
}

function findArrayLiteralDeclaration(
  sourceFile: ts.SourceFile,
  variableName: string,
): ts.ArrayLiteralExpression | null {
  let result: ts.ArrayLiteralExpression | null = null
  const visit = (node: ts.Node): void => {
    if (result) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      const arrayLiteral = unwrapArrayLiteral(node.initializer)
      if (arrayLiteral) {
        result = arrayLiteral
        return
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return result
}

function extractEvents(eventsFilePath: string | null): ModuleEventFact[] {
  const sourceFile = eventsFilePath ? readSourceFile(eventsFilePath) : null
  if (!sourceFile) return []

  const eventsArray = findArrayLiteralDeclaration(sourceFile, 'events')
  if (!eventsArray) return []

  const facts: ModuleEventFact[] = []
  for (const element of eventsArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    const id = readStringPropertyInitializer(element, 'id')
    if (!id) continue
    const label = readStringPropertyInitializer(element, 'label')
    const category = readStringPropertyInitializer(element, 'category')
    const entity = readStringPropertyInitializer(element, 'entity')
    const fact: ModuleEventFact = {
      id,
      category: category ?? null,
      entity: entity ?? null,
    }
    const clientBroadcast = readBooleanPropertyInitializer(element, 'clientBroadcast')
    const portalBroadcast = readBooleanPropertyInitializer(element, 'portalBroadcast')
    if (label !== undefined) fact.label = label
    if (clientBroadcast !== undefined) fact.clientBroadcast = clientBroadcast
    if (portalBroadcast !== undefined) fact.portalBroadcast = portalBroadcast
    facts.push(fact)
  }

  return facts
}

function extractAclFeatures(aclFilePath: string | null): string[] {
  const sourceFile = aclFilePath ? readSourceFile(aclFilePath) : null
  if (!sourceFile) return []

  const featuresArray = findArrayLiteralDeclaration(sourceFile, 'features')
  if (!featuresArray) return []

  const featureIds: string[] = []
  const seen = new Set<string>()
  for (const element of featuresArray.elements) {
    let featureId: string | undefined
    if (ts.isObjectLiteralExpression(element)) {
      featureId = readStringPropertyInitializer(element, 'id')
    } else if (ts.isStringLiteralLike(element)) {
      featureId = element.text
    }
    if (!featureId || seen.has(featureId)) continue
    seen.add(featureId)
    featureIds.push(featureId)
  }

  return featureIds
}

function readBooleanPropertyInitializer(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): boolean | undefined {
  const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
  if (!initializer) return undefined
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

function readStringArrayPropertyInitializer(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): string[] | undefined {
  const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
  if (!initializer) return undefined
  const arrayLiteral = unwrapArrayLiteral(initializer)
  if (!arrayLiteral) return undefined
  const values: string[] = []
  for (const element of arrayLiteral.elements) {
    if (ts.isStringLiteralLike(element)) values.push(element.text)
  }
  return values
}

function parseApiRouteAuthRule(metadataLiteral: ts.ObjectLiteralExpression): ApiRouteAuthRule {
  const rule: ApiRouteAuthRule = {}
  const requireAuth = readBooleanPropertyInitializer(metadataLiteral, 'requireAuth')
  if (requireAuth !== undefined) rule.requireAuth = requireAuth
  const requireFeatures = readStringArrayPropertyInitializer(metadataLiteral, 'requireFeatures')
  if (requireFeatures && requireFeatures.length > 0) rule.requireFeatures = requireFeatures
  const requireRoles = readStringArrayPropertyInitializer(metadataLiteral, 'requireRoles')
  if (requireRoles && requireRoles.length > 0) rule.requireRoles = requireRoles
  return rule
}

function parseApiRouteEntry(entryLiteral: ts.ObjectLiteralExpression): ModuleApiRouteFact | null {
  const routePath = readStringPropertyInitializer(entryLiteral, 'path')
  if (!routePath) return null

  const methods: string[] = []
  const seenMethods = new Set<string>()
  const handlersInitializer = getObjectPropertyInitializer(entryLiteral, 'handlers')
  if (handlersInitializer && ts.isObjectLiteralExpression(handlersInitializer)) {
    for (const property of handlersInitializer.properties) {
      const methodName = getPropertyName(property)
      if (methodName && !seenMethods.has(methodName)) {
        seenMethods.add(methodName)
        methods.push(methodName)
      }
    }
  } else {
    const singleMethod = readStringPropertyInitializer(entryLiteral, 'method')
    if (singleMethod && !seenMethods.has(singleMethod)) {
      seenMethods.add(singleMethod)
      methods.push(singleMethod)
    }
  }

  const auth: Record<string, ApiRouteAuthRule> = {}
  const metadataInitializer = getObjectPropertyInitializer(entryLiteral, 'metadata')
  if (metadataInitializer && ts.isObjectLiteralExpression(metadataInitializer)) {
    for (const property of metadataInitializer.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const methodName = getPropertyName(property)
      if (!methodName) continue
      const methodMetadata = unwrapExpression(property.initializer)
      if (!ts.isObjectLiteralExpression(methodMetadata)) continue
      auth[methodName] = parseApiRouteAuthRule(methodMetadata)
      if (!seenMethods.has(methodName)) {
        seenMethods.add(methodName)
        methods.push(methodName)
      }
    }
  }

  return { path: routePath, methods, auth, sourcePath: null }
}

function extractApiRoutes(
  moduleId: string,
  registrySource: string | null,
  registryDescription: string,
  routeSourcePaths: ReadonlyMap<string, string>,
  warnings: string[],
): ModuleApiRouteFact[] {
  if (registrySource == null) {
    warnings.push(`[module-facts] module registry unavailable (${registryDescription}); API route auth omitted for ${moduleId}`)
    return []
  }

  const sourceFile = ts.createSourceFile(
    'module-registry.generated.ts',
    registrySource,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TS,
  )

  const routes: ModuleApiRouteFact[] = []
  const seenPaths = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && readStringPropertyInitializer(node, 'id') === moduleId) {
      const apisInitializer = getObjectPropertyInitializer(node, 'apis')
      const apisArray = apisInitializer ? unwrapArrayLiteral(apisInitializer) : null
      if (apisArray) {
        for (const element of apisArray.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue
          const route = parseApiRouteEntry(element)
          if (route && !seenPaths.has(route.path)) {
            seenPaths.add(route.path)
            routes.push({ ...route, sourcePath: routeSourcePaths.get(route.path) ?? null })
          }
        }
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return routes
}

function resolveRegistrySource(options: ExtractModuleFactsOptions): { source: string | null; description: string } {
  if (typeof options.registrySource === 'string') {
    return { source: options.registrySource, description: 'registrySource' }
  }
  if (options.registryPath) {
    if (!fs.existsSync(options.registryPath)) {
      return { source: null, description: options.registryPath }
    }
    return { source: fs.readFileSync(options.registryPath, 'utf8'), description: options.registryPath }
  }
  return { source: null, description: 'registryPath not provided' }
}

function detectAwilixRegistrationKind(expression: ts.Expression): string | null {
  let current: ts.Expression = unwrapExpression(expression)
  while (ts.isCallExpression(current)) {
    const callee = current.expression
    if (ts.isIdentifier(callee)) return callee.text
    if (ts.isPropertyAccessExpression(callee)) {
      current = callee.expression
      continue
    }
    break
  }
  return null
}

function extractDiTokens(diFilePath: string | null): string[] {
  if (!diFilePath) return []
  const sourceFile = readSourceFile(diFilePath)
  if (!sourceFile) return []

  const tokens: string[] = []
  const seen = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'register'
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const kind = detectAwilixRegistrationKind(property.initializer)
          if (kind !== 'asFunction' && kind !== 'asClass') continue
          const tokenName = getPropertyName(property)
          if (tokenName && !seen.has(tokenName)) {
            seen.add(tokenName)
            tokens.push(tokenName)
          }
        }
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return tokens
}

function extractSearchEntities(searchFilePath: string | null, warnings: string[]): string[] {
  if (!searchFilePath) return []
  const sourceFile = readSourceFile(searchFilePath)
  if (!sourceFile) return []

  const searchConfig = findObjectLiteralDeclaration(sourceFile, 'searchConfig')
  if (!searchConfig) {
    warnings.push(`[module-facts] search.ts present but no searchConfig object literal: ${searchFilePath}`)
    return []
  }
  const entitiesInitializer = getObjectPropertyInitializer(searchConfig, 'entities')
  const entitiesArray = entitiesInitializer ? unwrapArrayLiteral(entitiesInitializer) : null
  if (!entitiesArray) {
    warnings.push(`[module-facts] searchConfig.entities is not an array literal: ${searchFilePath}`)
    return []
  }

  const entityIds: string[] = []
  const seen = new Set<string>()
  for (const element of entitiesArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    const entityId = readStringPropertyInitializer(element, 'entityId')
    if (entityId && !seen.has(entityId)) {
      seen.add(entityId)
      entityIds.push(entityId)
    }
  }
  return entityIds
}

function extractNotifications(notificationsFilePath: string | null, warnings: string[]): string[] {
  if (!notificationsFilePath) return []
  const sourceFile = readSourceFile(notificationsFilePath)
  if (!sourceFile) return []

  const notificationsArray =
    findArrayLiteralDeclaration(sourceFile, 'notificationTypes') ??
    findArrayLiteralDeclaration(sourceFile, 'notifications')
  if (!notificationsArray) {
    warnings.push(`[module-facts] notifications.ts present but no notificationTypes array literal: ${notificationsFilePath}`)
    return []
  }

  const notificationIds: string[] = []
  const seen = new Set<string>()
  for (const element of notificationsArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    const notificationId = readStringPropertyInitializer(element, 'type')
    if (notificationId && !seen.has(notificationId)) {
      seen.add(notificationId)
      notificationIds.push(notificationId)
    }
  }
  return notificationIds
}

function extractCli(cliFilePath: string | null, warnings: string[]): string[] {
  if (!cliFilePath) return []
  const sourceFile = readSourceFile(cliFilePath)
  if (!sourceFile) return []

  const defaultExport = findDefaultExportExpression(sourceFile)
  if (!defaultExport) {
    warnings.push(`[module-facts] cli.ts present but no default export: ${cliFilePath}`)
    return []
  }

  const initializers = buildVariableInitializerMap(sourceFile)
  const collectCommand = (objectLiteral: ts.ObjectLiteralExpression): string | undefined =>
    readStringPropertyInitializer(objectLiteral, 'command')

  const commands: string[] = []
  const seen = new Set<string>()
  const pushCommand = (command: string | undefined): void => {
    if (command && !seen.has(command)) {
      seen.add(command)
      commands.push(command)
    }
  }

  const arrayLiteral = resolveToArrayLiteral(defaultExport, initializers)
  if (arrayLiteral) {
    for (const element of arrayLiteral.elements) {
      const objectLiteral = resolveToObjectLiteral(element, initializers)
      if (objectLiteral) pushCommand(collectCommand(objectLiteral))
    }
    return commands
  }

  const singleObject = resolveToObjectLiteral(defaultExport, initializers)
  if (singleObject) {
    pushCommand(collectCommand(singleObject))
    return commands
  }

  warnings.push(`[module-facts] cli.ts default export is neither an array nor an object literal: ${cliFilePath}`)
  return commands
}

function listSourceFilesRecursive(directory: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === '__mocks__' || entry.name === 'node_modules') continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFilesRecursive(fullPath))
    } else if (
      /\.tsx?$/.test(entry.name)
      && !entry.name.endsWith('.d.ts')
      && !/\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      files.push(fullPath)
    }
  }
  return files
}

function toPortableSourceRoot(moduleId: string, sourcePackage: string | null): string {
  return path.posix.join('node_modules', sourcePackage ?? '@open-mercato/core', 'src', 'modules', moduleId)
}

function toPortableSourcePath(moduleRoot: string, sourceRoot: string, filePath: string): string {
  const relativePath = path.relative(moduleRoot, filePath).split(path.sep).join('/')
  return path.posix.join(sourceRoot, relativePath)
}

function sourceHasDefaultExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) return true
    if (!ts.isFunctionDeclaration(statement) && !ts.isClassDeclaration(statement)) return false
    return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false
  })
}

function readRouteMetadataPath(sourceFile: ts.SourceFile): string | null {
  const metadata = findObjectLiteralDeclaration(sourceFile, 'metadata')
  return metadata ? readStringPropertyInitializer(metadata, 'path') ?? null : null
}

function extractApiRouteSourcePaths(
  moduleId: string,
  moduleRoot: string,
  sourceRoot: string,
): Map<string, string> {
  const apiRoot = path.join(moduleRoot, 'api')
  const sources = new Map<string, string>()
  if (!fs.existsSync(apiRoot)) return sources
  const methodDirectories = new Set(['get', 'post', 'put', 'patch', 'delete'])

  for (const filePath of listSourceFilesRecursive(apiRoot)) {
    const relativePath = path.relative(apiRoot, filePath).split(path.sep).join('/')
    const segments = relativePath.split('/')
    const fileName = segments.pop() as string
    const fileStem = fileName.replace(/\.tsx?$/, '')
    let routeSegments: string[]
    if (fileStem === 'route') {
      routeSegments = segments
    } else if (segments[0] && methodDirectories.has(segments[0].toLowerCase())) {
      routeSegments = [...segments.slice(1), fileStem]
    } else {
      routeSegments = [...segments, fileStem]
    }
    const defaultPath = `/${[moduleId, ...routeSegments].filter(Boolean).join('/')}`
    const sourceFile = readSourceFile(filePath)
    const routePath = sourceFile ? readRouteMetadataPath(sourceFile) ?? defaultPath : defaultPath
    sources.set(routePath, toPortableSourcePath(moduleRoot, sourceRoot, filePath))
  }
  return sources
}

function extractModulePages(
  moduleId: string,
  moduleRoot: string,
  sourceRoot: string,
  surface: 'backend' | 'frontend',
): ModulePageFact[] {
  const pageRoot = path.join(moduleRoot, surface)
  if (!fs.existsSync(pageRoot)) return []
  const pages: ModulePageFact[] = []
  const seen = new Set<string>()

  for (const filePath of listSourceFilesRecursive(pageRoot)) {
    if (!filePath.endsWith('.tsx')) continue
    const relativePath = path.relative(pageRoot, filePath).split(path.sep).join('/')
    const segments = relativePath.split('/')
    const fileName = segments.pop() as string
    const fileStem = fileName.replace(/\.tsx$/, '')
    const isModernPage = fileStem === 'page'
    if (!isModernPage && (fileStem === 'meta' || fileStem.endsWith('.meta') || /^[A-Z]/.test(fileStem))) continue
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile || !sourceHasDefaultExport(sourceFile)) continue
    const routeSegments = isModernPage ? segments : [...segments, fileStem]
    const routePath = surface === 'frontend'
      ? `/${routeSegments.filter(Boolean).join('/')}`
      : isModernPage
        ? `/backend/${routeSegments.join('/') || moduleId}`
        : `/backend/${routeSegments[0] === moduleId
            ? routeSegments.filter(Boolean).join('/')
            : [moduleId, ...routeSegments].filter(Boolean).join('/')}`
    if (seen.has(routePath)) continue
    seen.add(routePath)
    const metadataFilePath = resolvePageMetadataFile(path.dirname(filePath))
    const metadataSourceFile = metadataFilePath ? readSourceFile(metadataFilePath) : sourceFile
    const metadata = metadataSourceFile ? readPageMetadata(metadataSourceFile) : undefined
    pages.push({
      path: routePath,
      sourcePath: toPortableSourcePath(moduleRoot, sourceRoot, filePath),
      ...(metadataFilePath
        ? { metadataSourcePath: toPortableSourcePath(moduleRoot, sourceRoot, metadataFilePath) }
        : {}),
      ...(metadata ? { metadata } : {}),
    })
  }
  return pages.sort((left, right) => left.path.localeCompare(right.path))
}

function findAncestorVariableDeclaration(node: ts.Node): ts.VariableDeclaration | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isVariableDeclaration(current)) return current
    current = current.parent
  }
  return null
}

function findAncestorCallExpression(node: ts.Node): ts.CallExpression | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isCallExpression(current)) return current
    if (ts.isVariableDeclaration(current) || ts.isStatement(current)) return null
    current = current.parent
  }
  return null
}

function extractNamedAiFacts(
  filePaths: readonly string[],
  moduleRoot: string,
  sourceRoot: string,
  propertyName: 'name' | 'id',
): Array<{ value: string; sourcePath: string }> {
  const facts: Array<{ value: string; sourcePath: string }> = []
  const seen = new Set<string>()
  for (const filePath of filePaths) {
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile) continue
    const initializers = buildVariableInitializerMap(sourceFile)
    const readDefinitionValue = (objectLiteral: ts.ObjectLiteralExpression): string | undefined => {
      const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
      if (!initializer) return undefined
      const resolved = unwrapExpression(initializer)
      if (ts.isStringLiteralLike(resolved)) return resolved.text
      if (ts.isIdentifier(resolved)) {
        const declarationInitializer = initializers.get(resolved.text)
        if (declarationInitializer) {
          const declarationValue = unwrapExpression(declarationInitializer)
          if (ts.isStringLiteralLike(declarationValue)) return declarationValue.text
        }
      }
      return undefined
    }
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const value = readDefinitionValue(node)
        if (value && !seen.has(value)) {
          const declaration = findAncestorVariableDeclaration(node)
          const declarationName = declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : ''
          const declarationType = declaration?.type?.getText(sourceFile) ?? ''
          const call = findAncestorCallExpression(node)
          const callee = call?.expression.getText(sourceFile) ?? ''
          const isDefinition = propertyName === 'name'
            ? /AiTool/.test(declarationType) || /tool$/i.test(declarationName) || /AiTool/.test(callee)
            : /AiAgentDefinition/.test(declarationType) || /agent$/i.test(declarationName) || /defineAiAgent/.test(callee)
          if (isDefinition) {
            seen.add(value)
            facts.push({
              value,
              sourcePath: toPortableSourcePath(moduleRoot, sourceRoot, filePath),
            })
          }
        }
      }
      node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)
  }
  return facts.sort((left, right) => left.value.localeCompare(right.value))
}

function extractAiTools(moduleRoot: string, sourceRoot: string): ModuleAiToolFact[] {
  const files = new Set<string>()
  const rootFile = resolveConventionFile(moduleRoot, 'ai-tools')
  if (rootFile) files.add(rootFile)
  const toolsDirectory = path.join(moduleRoot, 'ai-tools')
  if (fs.existsSync(toolsDirectory)) {
    for (const filePath of listSourceFilesRecursive(toolsDirectory)) files.add(filePath)
  }
  return extractNamedAiFacts([...files], moduleRoot, sourceRoot, 'name')
    .map((fact) => ({ name: fact.value, sourcePath: fact.sourcePath }))
}

function extractAiAgents(moduleRoot: string, sourceRoot: string): ModuleAiAgentFact[] {
  const agentsFile = resolveConventionFile(moduleRoot, 'ai-agents')
  if (!agentsFile) return []
  return extractNamedAiFacts([agentsFile], moduleRoot, sourceRoot, 'id')
    .map((fact) => ({ id: fact.value, sourcePath: fact.sourcePath }))
}

function extractTableIds(moduleRoot: string): string[] {
  if (!fs.existsSync(moduleRoot)) return []

  const tableIds: string[] = []
  const seen = new Set<string>()
  const collectLiteralValues = (expression: ts.Expression): string[] => {
    const current = unwrapExpression(expression)
    if (ts.isStringLiteralLike(current)) return [current.text]
    if (ts.isConditionalExpression(current)) {
      return [
        ...collectLiteralValues(current.whenTrue),
        ...collectLiteralValues(current.whenFalse),
      ]
    }
    return []
  }

  for (const filePath of listSourceFilesRecursive(moduleRoot)) {
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile) continue
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const propertyName = getPropertyName(node)
        if (propertyName === 'tableId' || propertyName === 'extensionTableId') {
          for (const value of collectLiteralValues(node.initializer)) {
            if (value && !seen.has(value)) {
              seen.add(value)
              tableIds.push(value)
            }
          }
        }
      }
      node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)
  }
  tableIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return tableIds
}

function extractHostEntityIds(entities: ModuleEntityFact[]): string[] {
  return entities.filter((entity) => entity.id.endsWith('_entity')).map((entity) => entity.id)
}

function extractModuleMeta(indexFilePath: string | null): { title: string | null; description: string | null } {
  if (!indexFilePath) return { title: null, description: null }
  const sourceFile = readSourceFile(indexFilePath)
  if (!sourceFile) return { title: null, description: null }
  const metadata = findObjectLiteralDeclaration(sourceFile, 'metadata')
  if (!metadata) return { title: null, description: null }
  return {
    title: readStringPropertyInitializer(metadata, 'title') ?? null,
    description: readStringPropertyInitializer(metadata, 'description') ?? null,
  }
}

function nodeLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function readPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  return undefined
}

function readMethodBearingPropertyNames(objectLiteral: ts.ObjectLiteralExpression): string[] {
  const names: string[] = []
  for (const property of objectLiteral.properties) {
    if (ts.isMethodDeclaration(property)) {
      const name = readPropertyNameText(property.name)
      if (name) names.push(name)
      continue
    }
    if (ts.isPropertyAssignment(property)) {
      const name = readPropertyNameText(property.name)
      if (!name) continue
      const initializer = unwrapExpression(property.initializer)
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) names.push(name)
    }
  }
  return names.sort((left, right) => left.localeCompare(right))
}

function readObjectKeyNames(objectLiteral: ts.ObjectLiteralExpression): string[] {
  const names: string[] = []
  for (const property of objectLiteral.properties) {
    const name = getPropertyName(property)
    if (name) names.push(name)
  }
  return names.sort((left, right) => left.localeCompare(right))
}

function mapDiRegistrationKind(base: string | null): ModuleDiRegistrationFact['registrationKind'] | null {
  switch (base) {
    case 'asFunction':
      return 'function'
    case 'asClass':
      return 'class'
    case 'asValue':
      return 'value'
    case 'aliasTo':
      return 'alias'
    default:
      return null
  }
}

function readDiChainMetadata(initializer: ts.Expression): {
  lifetime?: ModuleDiRegistrationFact['lifetime']
  injectionMode?: ModuleDiRegistrationFact['injectionMode']
} {
  const result: {
    lifetime?: ModuleDiRegistrationFact['lifetime']
    injectionMode?: ModuleDiRegistrationFact['injectionMode']
  } = {}
  let current: ts.Expression = unwrapExpression(initializer)
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const method = current.expression.name.text
    if ((method === 'singleton' || method === 'scoped' || method === 'transient') && !result.lifetime) {
      result.lifetime = method
    } else if (method === 'proxy' && !result.injectionMode) {
      result.injectionMode = 'proxy'
    } else if (method === 'classic' && !result.injectionMode) {
      result.injectionMode = 'classic'
    }
    current = unwrapExpression(current.expression.expression)
  }
  return result
}

function readDiProviderSymbol(
  initializer: ts.Expression,
  kind: ModuleDiRegistrationFact['registrationKind'],
): string | undefined {
  let current: ts.Expression = unwrapExpression(initializer)
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    current = unwrapExpression(current.expression.expression)
  }
  if (!ts.isCallExpression(current)) return undefined
  const argument = current.arguments[0]
  if (!argument) return undefined
  if (kind === 'value') return undefined
  if (kind === 'alias' && ts.isStringLiteralLike(argument)) return argument.text
  if ((kind === 'function' || kind === 'class') && ts.isIdentifier(argument)) return argument.text
  return undefined
}

function extractDiRegistrationFacts(
  diFilePath: string | null,
  sourcePath: string,
): { facts: ModuleDiRegistrationFact[]; unresolvedTokens: string[] } {
  if (!diFilePath) return { facts: [], unresolvedTokens: [] }
  const sourceFile = readSourceFile(diFilePath)
  if (!sourceFile) return { facts: [], unresolvedTokens: [] }

  const facts: ModuleDiRegistrationFact[] = []
  const unresolvedTokens: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'register'
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const token = getPropertyName(property)
          if (!token) continue
          const kind = mapDiRegistrationKind(detectAwilixRegistrationKind(property.initializer))
          if (!kind) {
            if (!unresolvedTokens.includes(token)) unresolvedTokens.push(token)
            continue
          }
          const chain = readDiChainMetadata(property.initializer)
          const providerSymbol = readDiProviderSymbol(property.initializer, kind)
          facts.push({
            token,
            registrationKind: kind,
            ...(providerSymbol ? { providerSymbol } : {}),
            ...(chain.lifetime ? { lifetime: chain.lifetime } : {}),
            ...(chain.injectionMode ? { injectionMode: chain.injectionMode } : {}),
            source: { sourcePath, exportName: token, line: nodeLine(sourceFile, property) },
          })
        }
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return { facts, unresolvedTokens }
}

function deriveLegacyDiTokens(facts: readonly ModuleDiRegistrationFact[]): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const fact of facts) {
    if (fact.registrationKind !== 'function' && fact.registrationKind !== 'class') continue
    if (seen.has(fact.token)) continue
    seen.add(fact.token)
    tokens.push(fact.token)
  }
  return tokens
}

function dedupeOwnedContractFacts(facts: readonly ModuleOwnedContractFact[]): ModuleOwnedContractFact[] {
  const byId = new Map<string, ModuleOwnedContractFact>()
  for (const fact of facts) {
    const existing = byId.get(fact.id)
    if (!existing) {
      byId.set(fact.id, fact)
      continue
    }
    if (fact.source.sourcePath.localeCompare(existing.source.sourcePath) < 0) byId.set(fact.id, fact)
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

const PAGE_CONTEXT_VALUES = new Set(['main', 'admin', 'settings', 'profile'])

function readAliasedStringProperty(
  metadata: ts.ObjectLiteralExpression,
  preferred: string,
  fallback: string,
): string | undefined {
  return readStringPropertyInitializer(metadata, preferred) ?? readStringPropertyInitializer(metadata, fallback)
}

function readNumericProperty(metadata: ts.ObjectLiteralExpression, propertyName: string): number | undefined {
  const initializer = getObjectPropertyInitializer(metadata, propertyName)
  if (!initializer || !ts.isNumericLiteral(initializer)) return undefined
  return Number(initializer.text)
}

function readPageMetadata(sourceFile: ts.SourceFile): ModulePageMetadata | undefined {
  const metadata = findObjectLiteralDeclaration(sourceFile, 'metadata')
  if (!metadata) return undefined
  const result: ModulePageMetadata = {}
  const requireAuth = readBooleanPropertyInitializer(metadata, 'requireAuth')
  if (requireAuth !== undefined) result.requireAuth = requireAuth
  const requireCustomerAuth = readBooleanPropertyInitializer(metadata, 'requireCustomerAuth')
  if (requireCustomerAuth !== undefined) result.requireCustomerAuth = requireCustomerAuth
  const requireFeatures = readStringArrayPropertyInitializer(metadata, 'requireFeatures')
  if (requireFeatures && requireFeatures.length > 0) result.requireFeatures = requireFeatures
  const requireCustomerFeatures = readStringArrayPropertyInitializer(metadata, 'requireCustomerFeatures')
  if (requireCustomerFeatures && requireCustomerFeatures.length > 0) {
    result.requireCustomerFeatures = requireCustomerFeatures
  }
  const navHidden = readBooleanPropertyInitializer(metadata, 'navHidden')
  if (navHidden !== undefined) result.navHidden = navHidden
  const navGroup = readAliasedStringProperty(metadata, 'pageGroup', 'group')
  if (navGroup) result.navGroup = navGroup
  const navGroupKey = readAliasedStringProperty(metadata, 'pageGroupKey', 'groupKey')
  if (navGroupKey) result.navGroupKey = navGroupKey
  const navOrder = readNumericProperty(metadata, 'pageOrder') ?? readNumericProperty(metadata, 'order')
  if (navOrder !== undefined) result.navOrder = navOrder
  const pageContext = readStringPropertyInitializer(metadata, 'pageContext')
  if (pageContext && PAGE_CONTEXT_VALUES.has(pageContext)) {
    result.pageContext = pageContext as ModulePageMetadata['pageContext']
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Mirrors the runtime companion-file convention: a page's metadata comes from
 * `page.meta.*` (or `meta.*`) in the page directory when one exists, and only
 * otherwise from the page component itself.
 */
function resolvePageMetadataFile(pageDirectory: string): string | null {
  for (const baseName of ['page.meta', 'meta']) {
    for (const extension of MODULE_CODE_EXTENSIONS) {
      const candidate = path.join(pageDirectory, `${baseName}${extension}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function extractModuleMetadataContract(
  indexFilePath: string | null,
  moduleId: string,
  sourcePath: string | null,
): ModuleOwnedContractFact | null {
  if (!indexFilePath || !sourcePath) return null
  const sourceFile = readSourceFile(indexFilePath)
  if (!sourceFile) return null
  const metadata = findObjectLiteralDeclaration(sourceFile, 'metadata')
  if (!metadata) return null
  const facts: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]> = {}
  const name = readStringPropertyInitializer(metadata, 'name')
  if (name) facts.name = name
  const version = readStringPropertyInitializer(metadata, 'version')
  if (version) facts.version = version
  const requires = readStringArrayPropertyInitializer(metadata, 'requires')
  if (requires && requires.length > 0) facts.requires = requires
  const ejectable = readBooleanPropertyInitializer(metadata, 'ejectable')
  if (ejectable !== undefined) facts.ejectable = ejectable
  return {
    kind: 'module-metadata',
    id: moduleId,
    source: { sourcePath, exportName: 'metadata', line: nodeLine(sourceFile, metadata) },
    ...(Object.keys(facts).length > 0 ? { metadata: facts } : {}),
  }
}

function extractCommandContractCandidates(
  moduleId: string,
  moduleRoot: string,
  sourceRoot: string,
): Array<{ id: string; sourcePath: string }> {
  const commandsRoot = path.join(moduleRoot, 'commands')
  if (!fs.existsSync(commandsRoot)) return []
  const candidates: Array<{ id: string; sourcePath: string }> = []
  for (const filePath of listSourceFilesRecursive(commandsRoot)) {
    if (path.basename(filePath).replace(/\.tsx?$/, '') === 'interceptors') continue
    const sourcePath = toPortableSourcePath(moduleRoot, sourceRoot, filePath)
    for (const id of extractCommandIdsFromSource(filePath)) candidates.push({ id, sourcePath })
  }
  return candidates
}

/**
 * Runtime worker id: `metadata.id` when declared, otherwise the path-derived
 * `<moduleId>:workers:<...segments>:<fileStem>` that `discoverWorkers` builds.
 */
function deriveWorkerId(moduleId: string, workersRoot: string, filePath: string): string {
  const relativePath = path.relative(workersRoot, filePath).split(path.sep).join('/')
  const segments = relativePath.split('/')
  const fileName = segments.pop() as string
  const fileStem = fileName.replace(/\.tsx?$/, '')
  return [moduleId, 'workers', ...segments, fileStem].filter(Boolean).join(':')
}

/** Resolves a string property directly or through a local `const` in the same file. */
function readResolvedStringProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
  initializers: Map<string, ts.Expression>,
): string | undefined {
  const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
  if (!initializer) return undefined
  const resolved = unwrapExpression(initializer)
  if (ts.isStringLiteralLike(resolved)) return resolved.text
  if (ts.isIdentifier(resolved)) {
    const declaration = initializers.get(resolved.text)
    if (declaration) {
      const declarationValue = unwrapExpression(declaration)
      if (ts.isStringLiteralLike(declarationValue)) return declarationValue.text
    }
  }
  return undefined
}

function extractWorkerContracts(
  moduleId: string,
  moduleRoot: string,
  sourceRoot: string,
): { facts: ModuleOwnedContractFact[]; unresolved: ModuleFactDiagnostic[] } {
  const workersRoot = path.join(moduleRoot, 'workers')
  if (!fs.existsSync(workersRoot)) return { facts: [], unresolved: [] }
  const facts: ModuleOwnedContractFact[] = []
  const unresolved: ModuleFactDiagnostic[] = []
  for (const filePath of listSourceFilesRecursive(workersRoot)) {
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile) continue
    const metadata = findObjectLiteralDeclaration(sourceFile, 'metadata')
    if (!metadata) continue
    const sourcePath = toPortableSourcePath(moduleRoot, sourceRoot, filePath)
    const source = { sourcePath, exportName: 'metadata', line: nodeLine(sourceFile, metadata) }
    const initializers = buildVariableInitializerMap(sourceFile)
    const workerId = readResolvedStringProperty(metadata, 'id', initializers)
      ?? deriveWorkerId(moduleId, workersRoot, filePath)

    // Runtime skips any worker without a queue, so a worker missing the required
    // property is not a contract; a present-but-dynamic queue is reported instead.
    const hasQueueProperty = getObjectPropertyInitializer(metadata, 'queue') !== undefined
    const queue = readResolvedStringProperty(metadata, 'queue', initializers)
    if (!hasQueueProperty) {
      unresolved.push({ code: 'unresolved-static-contract', kind: 'worker', id: workerId, source })
      continue
    }

    const workerMetadata: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]> = {}
    if (queue) workerMetadata.queue = queue
    else unresolved.push({ code: 'unresolved-static-contract', kind: 'worker', id: workerId, source })
    const name = readResolvedStringProperty(metadata, 'name', initializers)
    if (name) workerMetadata.name = name
    const concurrencyInitializer = getObjectPropertyInitializer(metadata, 'concurrency')
    if (concurrencyInitializer && ts.isNumericLiteral(concurrencyInitializer)) {
      workerMetadata.concurrency = Number(concurrencyInitializer.text)
    }
    facts.push({
      kind: 'worker',
      id: workerId,
      source,
      ...(Object.keys(workerMetadata).length > 0 ? { metadata: workerMetadata } : {}),
    })
  }
  return { facts: dedupeOwnedContractFacts(facts), unresolved }
}

function extractPageMiddlewareContracts(
  moduleRoot: string,
  sourceRoot: string,
): { facts: ModuleOwnedContractFact[]; unresolved: ModuleFactDiagnostic[] } {
  const facts: ModuleOwnedContractFact[] = []
  const unresolved: ModuleFactDiagnostic[] = []
  for (const surface of ['backend', 'frontend'] as const) {
    const filePath = resolveConventionFile(path.join(moduleRoot, surface), 'middleware')
    if (!filePath) continue
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile) continue
    const sourcePath = toPortableSourcePath(moduleRoot, sourceRoot, filePath)
    const middlewareArray =
      findArrayLiteralDeclaration(sourceFile, 'middleware') ??
      (() => {
        const defaultExport = findDefaultExportExpression(sourceFile)
        return defaultExport ? unwrapArrayLiteral(defaultExport) : null
      })()
    if (!middlewareArray) continue
    let index = 0
    for (const element of middlewareArray.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue
      const middlewareId = readStringPropertyInitializer(element, 'id')
      if (!middlewareId) {
        unresolved.push({
          code: 'unresolved-static-contract',
          kind: 'page-middleware',
          id: `${sourcePath}#${index}`,
          source: { sourcePath, line: nodeLine(sourceFile, element) },
        })
        index += 1
        continue
      }
      const metadata: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]> = { surface }
      const mode = readStringPropertyInitializer(element, 'mode')
      if (mode) metadata.mode = mode
      const priorityInitializer = getObjectPropertyInitializer(element, 'priority')
      if (priorityInitializer && ts.isNumericLiteral(priorityInitializer)) {
        metadata.priority = Number(priorityInitializer.text)
      }
      facts.push({
        kind: 'page-middleware',
        id: middlewareId,
        source: { sourcePath, exportName: 'middleware', line: nodeLine(sourceFile, element) },
        metadata,
      })
      index += 1
    }
  }
  return { facts: dedupeOwnedContractFacts(facts), unresolved }
}

function extractSetupContract(
  moduleId: string,
  setupFilePath: string | null,
  sourcePath: string | null,
): ModuleOwnedContractFact | null {
  if (!setupFilePath || !sourcePath) return null
  const sourceFile = readSourceFile(setupFilePath)
  if (!sourceFile) return null
  const setupObject =
    findObjectLiteralDeclaration(sourceFile, 'setup') ??
    (() => {
      const defaultExport = findDefaultExportExpression(sourceFile)
      if (!defaultExport) return null
      const unwrapped = unwrapExpression(defaultExport)
      return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : null
    })()
  if (!setupObject) return null
  const hooks = readMethodBearingPropertyNames(setupObject)
  const metadata: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]> = {}
  if (hooks.length > 0) metadata.hooks = hooks
  const roleFeatures = getObjectPropertyInitializer(setupObject, 'defaultRoleFeatures')
  if (roleFeatures && ts.isObjectLiteralExpression(roleFeatures)) {
    const roles = readObjectKeyNames(roleFeatures)
    if (roles.length > 0) metadata.roles = roles
  }
  const customerRoleFeatures = getObjectPropertyInitializer(setupObject, 'defaultCustomerRoleFeatures')
  if (customerRoleFeatures && ts.isObjectLiteralExpression(customerRoleFeatures)) {
    const customerRoles = readObjectKeyNames(customerRoleFeatures)
    if (customerRoles.length > 0) metadata.customerRoles = customerRoles
  }
  return {
    kind: 'setup',
    id: `${moduleId}:setup`,
    source: { sourcePath, exportName: 'setup', line: nodeLine(sourceFile, setupObject) },
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

function extractEncryptionContracts(
  encryptionFilePath: string | null,
  sourcePath: string | null,
): ModuleOwnedContractFact[] {
  if (!encryptionFilePath || !sourcePath) return []
  const sourceFile = readSourceFile(encryptionFilePath)
  if (!sourceFile) return []
  const mapsArray =
    findArrayLiteralDeclaration(sourceFile, 'defaultEncryptionMaps') ??
    findArrayLiteralDeclaration(sourceFile, 'encryptionMaps')
  if (!mapsArray) return []
  const facts: ModuleOwnedContractFact[] = []
  for (const element of mapsArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    const entityId = readStringPropertyInitializer(element, 'entityId')
    if (!entityId) continue
    const fieldsInitializer = getObjectPropertyInitializer(element, 'fields')
    const fields: string[] = []
    if (fieldsInitializer) {
      const fieldsArray = unwrapArrayLiteral(fieldsInitializer)
      if (fieldsArray) {
        for (const fieldElement of fieldsArray.elements) {
          if (!ts.isObjectLiteralExpression(fieldElement)) continue
          const field = readStringPropertyInitializer(fieldElement, 'field')
          if (field) fields.push(field)
        }
      }
    }
    facts.push({
      kind: 'encryption',
      id: entityId,
      source: { sourcePath, exportName: 'defaultEncryptionMaps', line: nodeLine(sourceFile, element) },
      ...(fields.length > 0 ? { metadata: { fields: fields.sort((left, right) => left.localeCompare(right)) } } : {}),
    })
  }
  return dedupeOwnedContractFacts(facts)
}

function extractCustomEntityContracts(
  ceFilePath: string | null,
  sourcePath: string | null,
): ModuleOwnedContractFact[] {
  if (!ceFilePath || !sourcePath) return []
  const entityIds = [...collectCustomFieldEntityIds(ceFilePath)].sort((left, right) => left.localeCompare(right))
  return entityIds.map((id) => ({
    kind: 'custom-entity' as const,
    id,
    source: { sourcePath, exportName: 'default' },
  }))
}

/**
 * Keyed AI override exports. Agent *extensions* (`aiAgentExtensions`) patch an agent
 * additively and belong to the `ai.extensions` array; these two replace or disable an
 * entry by key and map to exact `ai.agents.<id>` / `ai.tools.<id>` override targets.
 */
const AI_OVERRIDE_EXPORTS = [
  { exportName: 'aiAgentOverrides', target: 'agent' },
  { exportName: 'aiToolOverrides', target: 'tool' },
] as const

function extractAiExtensionContracts(
  moduleRoot: string,
  sourceRoot: string,
): ModuleOwnedContractFact[] {
  const facts: ModuleOwnedContractFact[] = []
  const sources: Array<{ basename: string; relativeDir: string }> = [
    { basename: 'ai-agents', relativeDir: '.' },
    { basename: 'ai-tools', relativeDir: '.' },
    { basename: 'ai-agents.extensions', relativeDir: '.' },
    { basename: 'ai-tools.extensions', relativeDir: '.' },
  ]
  for (const entry of sources) {
    const filePath = resolveConventionFile(path.join(moduleRoot, entry.relativeDir), entry.basename)
    if (!filePath) continue
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile) continue
    const sourcePath = toPortableSourcePath(moduleRoot, sourceRoot, filePath)
    const extensionsArray = findArrayLiteralDeclaration(sourceFile, 'aiAgentExtensions')
    if (extensionsArray) {
      for (const element of extensionsArray.elements) {
        const objectLiteral = ts.isObjectLiteralExpression(element)
          ? element
          : ts.isCallExpression(element) && element.arguments[0] && ts.isObjectLiteralExpression(element.arguments[0])
            ? element.arguments[0]
            : null
        if (!objectLiteral) continue
        const targetAgentId = readStringPropertyInitializer(objectLiteral, 'targetAgentId')
        if (!targetAgentId) continue
        facts.push({
          kind: 'ai-extension',
          id: `agent-extension:${targetAgentId}`,
          source: { sourcePath, exportName: 'aiAgentExtensions', line: nodeLine(sourceFile, objectLiteral) },
          metadata: { target: 'agent', mode: 'extension', targetAgentId },
        })
      }
    }
    // `aiAgentOverrides` / `aiToolOverrides` are keyed replace-or-disable maps; only
    // their keys are contract facts. Values (agent/tool definitions, `null` disables)
    // are never read or serialized.
    for (const { exportName, target } of AI_OVERRIDE_EXPORTS) {
      const overridesObject = findObjectLiteralDeclaration(sourceFile, exportName)
      if (!overridesObject) continue
      for (const property of overridesObject.properties) {
        const overrideId = getPropertyName(property)
        if (!overrideId) continue
        facts.push({
          kind: 'ai-extension',
          id: `${target}-override:${overrideId}`,
          source: { sourcePath, exportName, line: nodeLine(sourceFile, property) },
          metadata: { target, mode: 'override', overrideKey: overrideId },
        })
      }
    }
  }
  return dedupeOwnedContractFacts(facts)
}

function extractGeneratorPluginContracts(
  moduleRoot: string,
  sourceRoot: string,
): { facts: ModuleOwnedContractFact[]; unresolved: ModuleFactDiagnostic[] } {
  const filePath = resolveConventionFile(moduleRoot, 'generators')
  if (!filePath) return { facts: [], unresolved: [] }
  const sourceFile = readSourceFile(filePath)
  if (!sourceFile) return { facts: [], unresolved: [] }
  const pluginsArray = findArrayLiteralDeclaration(sourceFile, 'generatorPlugins')
  if (!pluginsArray) return { facts: [], unresolved: [] }
  const sourcePath = toPortableSourcePath(moduleRoot, sourceRoot, filePath)
  const initializers = buildVariableInitializerMap(sourceFile)
  const facts: ModuleOwnedContractFact[] = []
  const unresolved: ModuleFactDiagnostic[] = []
  let index = 0
  for (const element of pluginsArray.elements) {
    const objectLiteral = resolveToObjectLiteral(element, initializers)
    if (!objectLiteral) {
      index += 1
      continue
    }
    const pluginId = readStringPropertyInitializer(objectLiteral, 'id')
    if (!pluginId) {
      unresolved.push({
        code: 'unresolved-static-contract',
        kind: 'generator-plugin',
        id: `${sourcePath}#${index}`,
        source: { sourcePath, exportName: 'generatorPlugins', line: nodeLine(sourceFile, objectLiteral) },
      })
      index += 1
      continue
    }
    const metadata: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]> = {}
    const conventionFile = readStringPropertyInitializer(objectLiteral, 'conventionFile')
    if (conventionFile) metadata.conventionFile = conventionFile
    const outputFileName = readStringPropertyInitializer(objectLiteral, 'outputFileName')
    if (outputFileName) metadata.outputFileName = outputFileName
    facts.push({
      kind: 'generator-plugin',
      id: pluginId,
      source: { sourcePath, exportName: 'generatorPlugins', line: nodeLine(sourceFile, objectLiteral) },
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    })
    index += 1
  }
  return { facts: dedupeOwnedContractFacts(facts), unresolved }
}

function compareSourceRefs(left: ModuleFactSourceRef, right: ModuleFactSourceRef): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.exportName ?? '').localeCompare(right.exportName ?? '')
  )
}

function sameSourceRef(left: ModuleFactSourceRef, right: ModuleFactSourceRef): boolean {
  return (
    left.sourcePath === right.sourcePath &&
    (left.line ?? null) === (right.line ?? null) &&
    (left.exportName ?? null) === (right.exportName ?? null)
  )
}

// Every proven `(kind, id)` reaches `factSources`. Facts whose declaration site is already
// serialized inline (pages, CLI commands, routes, AI tools/agents, reused contributions) and
// the owned families (which carry `source` inside `ownedContracts`) are emitted as a typed
// `factRef` pointer instead of a duplicated source ref, so the index stays uniform without
// copying provenance payloads past the determinism byte guard. Duplicate detection runs over
// ALL candidates regardless of which projection they take.
type ProvenanceCandidate = {
  kind: ModuleFactSourceKind
  id: string
  source?: ModuleFactSourceRef
  factRef?: ModuleFactRef
}

function provenanceCandidateOrderKey(candidate: ProvenanceCandidate): string {
  if (candidate.source) {
    return JSON.stringify([
      0,
      candidate.source.sourcePath,
      candidate.source.line ?? 0,
      candidate.source.exportName ?? '',
    ])
  }
  return JSON.stringify([1, candidate.factRef?.factSection ?? '', candidate.factRef?.factKey ?? ''])
}

function buildProvenanceIndex(candidates: readonly ProvenanceCandidate[]): {
  factSources: ModuleFactSourceEntry[]
  diagnostics: ModuleFactDiagnostic[]
} {
  const grouped = new Map<string, ProvenanceCandidate[]>()
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.kind, candidate.id])
    const group = grouped.get(key) ?? []
    group.push(candidate)
    grouped.set(key, group)
  }
  // Keep the provenance index compact: sourcePath is the provenance and (kind,id) the
  // stable identity, so exportName and line (recoverable from source) are dropped here.
  // Owned families retain the richer source ref inside `ownedContracts`.
  const factSources: ModuleFactSourceEntry[] = []
  const diagnostics: ModuleFactDiagnostic[] = []
  for (const group of grouped.values()) {
    const sorted = [...group].sort(
      (left, right) => provenanceCandidateOrderKey(left).localeCompare(provenanceCandidateOrderKey(right)),
    )
    const canonical = sorted[0]
    factSources.push(
      canonical.factRef
        ? {
            kind: canonical.kind,
            id: canonical.id,
            factRef: {
              factSection: canonical.factRef.factSection,
              ...(canonical.factRef.factKey === canonical.id
                ? {}
                : { factKey: canonical.factRef.factKey }),
            },
          }
        : {
            kind: canonical.kind,
            id: canonical.id,
            source: { sourcePath: (canonical.source as ModuleFactSourceRef).sourcePath },
          },
    )
    const canonicalKey = provenanceCandidateOrderKey(canonical)
    for (const rejected of sorted.slice(1)) {
      if (provenanceCandidateOrderKey(rejected) === canonicalKey) continue
      diagnostics.push({
        code: 'duplicate-source',
        kind: rejected.kind,
        id: rejected.id,
        ...(rejected.source ? { source: rejected.source } : {}),
      })
    }
  }
  factSources.sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  )
  diagnostics.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      compareSourceRefs(left.source ?? { sourcePath: '' }, right.source ?? { sourcePath: '' }),
  )
  return { factSources, diagnostics }
}

function buildOwnedContracts(
  families: ReadonlyArray<[ModuleOwnedContractKind, ModuleOwnedContractFact[]]>,
): ModuleOwnedContracts | undefined {
  const result: ModuleOwnedContracts = {}
  for (const [kind, facts] of families) {
    if (facts.length === 0) continue
    // Drop the (constant/redundant) exportName from the emitted source ref; the line
    // anchor plus sourcePath already pin the declaration and keep the JSON compact.
    result[kind] = facts.map((fact) => ({
      ...fact,
      source: {
        sourcePath: fact.source.sourcePath,
        ...(fact.source.line ? { line: fact.source.line } : {}),
      },
    }))
  }
  return Object.keys(result).length > 0 ? result : undefined
}

const CONTRIBUTION_KIND_TO_SOURCE_KIND: Partial<Record<string, ModuleFactSourceKind>> = {
  subscriber: 'subscriber',
}

const REGISTRY_TO_SOURCE_KIND: Partial<Record<string, ModuleFactSourceKind>> = {
  vector: 'vector',
  integration: 'integration',
  payment: 'integration',
  shipping: 'integration',
  currency: 'integration',
}

export function extractModuleFacts(options: ExtractModuleFactsOptions): ModuleFacts {
  const { moduleId, coreVersion = null, sourcePackage = null, sourceVersion = null } = options
  const moduleRoot = options.moduleRoot
    ?? (options.coreSrcRoot ? path.join(options.coreSrcRoot, moduleId) : null)
  if (!moduleRoot) {
    throw new Error(`[internal] extractModuleFacts requires moduleRoot or coreSrcRoot for module "${moduleId}"`)
  }
  const sourceRoot = toPortableSourceRoot(moduleId, sourcePackage)

  const entitiesFilePath =
    resolveConventionFile(path.join(moduleRoot, 'data'), 'entities') ??
    resolveConventionFile(path.join(moduleRoot, 'db'), 'entities') ??
    resolveConventionFile(path.join(moduleRoot, 'data'), 'schema')
  const ceFilePath = resolveConventionFile(moduleRoot, 'ce')
  const eventsFilePath = resolveConventionFile(moduleRoot, 'events')
  const aclFilePath = resolveConventionFile(moduleRoot, 'acl')
  const diFilePath = resolveConventionFile(moduleRoot, 'di')
  const searchFilePath = resolveConventionFile(moduleRoot, 'search')
  const notificationsFilePath = resolveConventionFile(moduleRoot, 'notifications')
  const cliFilePath = resolveConventionFile(moduleRoot, 'cli')
  const indexFilePath = resolveConventionFile(moduleRoot, 'index')
  const setupFilePath = resolveConventionFile(moduleRoot, 'setup')
  const encryptionFilePath = resolveConventionFile(moduleRoot, 'encryption')

  const portableOf = (filePath: string | null): string | null =>
    filePath ? toPortableSourcePath(moduleRoot, sourceRoot, filePath) : null

  const warnings: string[] = []
  const { title, description } = extractModuleMeta(indexFilePath)
  const customFieldEntityIds = collectCustomFieldEntityIds(ceFilePath)
  const entities = extractEntities(moduleId, entitiesFilePath, customFieldEntityIds)
  const events = extractEvents(eventsFilePath)
  const aclFeatures = extractAclFeatures(aclFilePath)

  const { source: registrySource, description: registryDescription } = resolveRegistrySource(options)
  const apiRouteSourcePaths = extractApiRouteSourcePaths(moduleId, moduleRoot, sourceRoot)
  const apiRoutes = extractApiRoutes(moduleId, registrySource, registryDescription, apiRouteSourcePaths, warnings)
  const diRegistrations = extractDiRegistrationFacts(diFilePath, portableOf(diFilePath) ?? '')
  const diTokens = deriveLegacyDiTokens(diRegistrations.facts)
  for (const legacyToken of extractDiTokens(diFilePath)) {
    if (!diTokens.includes(legacyToken)) diTokens.push(legacyToken)
  }
  const searchEntities = extractSearchEntities(searchFilePath, warnings)
  const notifications = extractNotifications(notificationsFilePath, warnings)
  const cli = extractCli(cliFilePath, warnings)
  const cliCommands = cliFilePath
    ? cli.map((command) => ({
        command,
        sourcePath: toPortableSourcePath(moduleRoot, sourceRoot, cliFilePath),
      }))
    : []
  const backendPages = extractModulePages(moduleId, moduleRoot, sourceRoot, 'backend')
  const frontendPages = extractModulePages(moduleId, moduleRoot, sourceRoot, 'frontend')
  const aiTools = extractAiTools(moduleRoot, sourceRoot)
  const aiAgents = extractAiAgents(moduleRoot, sourceRoot)
  const hostTokens: ModuleHostTokens = {
    entityIds: extractHostEntityIds(entities),
    tableIds: extractTableIds(moduleRoot),
  }
  const extensionSurfaces = extractModuleExtensionFacts({
    moduleId,
    moduleRoot,
    sourceRoot,
    entities,
    events,
    apiRoutes,
    searchEntities,
    notifications,
    aiTools,
    aiAgents,
  })

  const indexSourcePath = portableOf(indexFilePath)
  const diSourcePath = portableOf(diFilePath)
  const moduleMetadataFact = extractModuleMetadataContract(indexFilePath, moduleId, indexSourcePath)
  const commandCandidates = extractCommandContractCandidates(moduleId, moduleRoot, sourceRoot)
  const commandFacts = dedupeOwnedContractFacts(
    commandCandidates.map((candidate) => ({
      kind: 'command' as const,
      id: candidate.id,
      source: { sourcePath: candidate.sourcePath },
    })),
  )
  const workers = extractWorkerContracts(moduleId, moduleRoot, sourceRoot)
  const pageMiddleware = extractPageMiddlewareContracts(moduleRoot, sourceRoot)
  const setupFact = extractSetupContract(moduleId, setupFilePath, portableOf(setupFilePath))
  const encryptionFacts = extractEncryptionContracts(encryptionFilePath, portableOf(encryptionFilePath))
  const customEntityFacts = extractCustomEntityContracts(ceFilePath, portableOf(ceFilePath))
  const aiExtensionFacts = extractAiExtensionContracts(moduleRoot, sourceRoot)
  const generatorPlugins = extractGeneratorPluginContracts(moduleRoot, sourceRoot)
  const diContractFacts = dedupeOwnedContractFacts(
    diRegistrations.facts.map((fact) => ({
      kind: 'di-registration' as const,
      id: fact.token,
      source: fact.source,
      metadata: {
        registrationKind: fact.registrationKind,
        ...(fact.providerSymbol ? { providerSymbol: fact.providerSymbol } : {}),
        ...(fact.lifetime ? { lifetime: fact.lifetime } : {}),
        ...(fact.injectionMode ? { injectionMode: fact.injectionMode } : {}),
      },
    })),
  )

  const ownedContracts = buildOwnedContracts([
    ['module-metadata', moduleMetadataFact ? [moduleMetadataFact] : []],
    ['command', commandFacts],
    ['worker', workers.facts],
    ['page-middleware', pageMiddleware.facts],
    ['setup', setupFact ? [setupFact] : []],
    ['encryption', encryptionFacts],
    ['di-registration', diContractFacts],
    ['custom-entity', customEntityFacts],
    ['ai-extension', aiExtensionFacts],
    ['generator-plugin', generatorPlugins.facts],
  ])

  const provenanceCandidates: ProvenanceCandidate[] = []
  const pushSource = (kind: ModuleFactSourceKind, id: string, source: ModuleFactSourceRef): void => {
    provenanceCandidates.push({ kind, id, source })
  }
  const pushRef = (
    kind: ModuleFactSourceKind,
    id: string,
    source: ModuleFactSourceRef,
    factSection: string,
    factKey: string,
  ): void => {
    provenanceCandidates.push({ kind, id, source, factRef: { factSection, factKey } })
  }
  const pushOwnedRefs = (kind: ModuleOwnedContractKind, facts: readonly ModuleOwnedContractFact[]): void => {
    for (const fact of facts) pushRef(kind, fact.id, fact.source, `ownedContracts.${kind}`, fact.id)
  }
  if (moduleMetadataFact) {
    pushRef(
      'module-metadata',
      moduleId,
      moduleMetadataFact.source,
      'ownedContracts.module-metadata',
      moduleMetadataFact.id,
    )
  }
  if (entitiesFilePath) {
    const entitiesSourcePath = portableOf(entitiesFilePath) as string
    for (const entity of entities) {
      pushSource('entity', entity.id, { sourcePath: entitiesSourcePath, exportName: entity.class })
    }
  }
  if (eventsFilePath) {
    const eventsSourcePath = portableOf(eventsFilePath) as string
    for (const event of events) pushSource('event', event.id, { sourcePath: eventsSourcePath, exportName: 'events' })
  }
  if (aclFilePath) {
    const aclSourcePath = portableOf(aclFilePath) as string
    for (const feature of aclFeatures) pushSource('acl-feature', feature, { sourcePath: aclSourcePath, exportName: 'features' })
  }
  for (const route of apiRoutes) {
    if (route.sourcePath) {
      pushRef('api-route', route.path, { sourcePath: route.sourcePath }, 'apiRoutes', route.path)
    }
  }
  if (searchFilePath) {
    const searchSourcePath = portableOf(searchFilePath) as string
    for (const entityId of searchEntities) pushSource('search', entityId, { sourcePath: searchSourcePath, exportName: 'searchConfig' })
  }
  if (notificationsFilePath) {
    const notificationsSourcePath = portableOf(notificationsFilePath) as string
    for (const id of notifications) pushSource('notification', id, { sourcePath: notificationsSourcePath })
  }
  for (const command of cliCommands) {
    pushRef('cli-command', command.command, { sourcePath: command.sourcePath }, 'cliCommands', command.command)
  }
  for (const page of backendPages) {
    pushRef('backend-page', page.path, { sourcePath: page.sourcePath }, 'backendPages', page.path)
  }
  for (const page of frontendPages) {
    pushRef('frontend-page', page.path, { sourcePath: page.sourcePath }, 'frontendPages', page.path)
  }
  for (const tool of aiTools) pushRef('ai-tool', tool.name, { sourcePath: tool.sourcePath }, 'aiTools', tool.name)
  for (const agent of aiAgents) pushRef('ai-agent', agent.id, { sourcePath: agent.sourcePath }, 'aiAgents', agent.id)
  for (const candidate of commandCandidates) {
    pushRef('command', candidate.id, { sourcePath: candidate.sourcePath }, 'ownedContracts.command', candidate.id)
  }
  pushOwnedRefs('worker', workers.facts)
  pushOwnedRefs('page-middleware', pageMiddleware.facts)
  if (setupFact) pushOwnedRefs('setup', [setupFact])
  pushOwnedRefs('encryption', encryptionFacts)
  for (const fact of diRegistrations.facts) {
    pushRef('di-registration', fact.token, fact.source, 'ownedContracts.di-registration', fact.token)
  }
  pushOwnedRefs('custom-entity', customEntityFacts)
  pushOwnedRefs('ai-extension', aiExtensionFacts)
  pushOwnedRefs('generator-plugin', generatorPlugins.facts)
  const contributionRef = (contributionId: string): { factSection: string; factKey: string } => ({
    factSection: 'extensionSurfaces.contributions',
    factKey: contributionId,
  })
  for (const contribution of extensionSurfaces.contributions) {
    const contributionSource: ModuleFactSourceRef = {
      sourcePath: contribution.source.path,
      ...(contribution.source.symbol ? { exportName: contribution.source.symbol } : {}),
    }
    const ref = contributionRef(contribution.id)
    if (contribution.kind === 'subscriber') {
      pushRef('subscriber', contribution.id, contributionSource, ref.factSection, ref.factKey)
      continue
    }
    if (contribution.kind === 'specialized-registry') {
      const details = contribution.details as { registry?: string; registryId?: string }
      const sourceKind = details.registry ? REGISTRY_TO_SOURCE_KIND[details.registry] : undefined
      if (sourceKind) {
        pushRef(
          sourceKind,
          details.registryId ?? contribution.id,
          contributionSource,
          ref.factSection,
          ref.factKey,
        )
      }
      continue
    }
    const mapped = CONTRIBUTION_KIND_TO_SOURCE_KIND[contribution.kind]
    if (mapped) pushRef(mapped, contribution.id, contributionSource, ref.factSection, ref.factKey)
  }
  // extension-host / extension-contribution provenance is emitted as typed `factRef` pointers
  // rather than duplicated source refs: those facts already carry their own `source` inside
  // `extensionSurfaces.{hosts,contributions}`, and copying every declared host spot (hundreds
  // per large module) would push the shared JSON past the determinism byte guard asserted in
  // `module-facts.bc-guard.test.ts`.
  // Hosts are indexed by their registry `key`: `id` repeats across families (an entity id is
  // also an api-entity id), while `key` is unique inside a module.
  for (const host of extensionSurfaces.hosts) {
    provenanceCandidates.push({
      kind: 'extension-host',
      id: host.key,
      ...(host.source.kind === 'fact-ref' ? {} : { source: { sourcePath: host.source.path } }),
      factRef: { factSection: 'extensionSurfaces.hosts', factKey: host.key },
    })
  }
  for (const contribution of extensionSurfaces.contributions) {
    pushRef(
      'extension-contribution',
      contribution.id,
      { sourcePath: contribution.source.path },
      'extensionSurfaces.contributions',
      contribution.id,
    )
  }

  const provenance = buildProvenanceIndex(provenanceCandidates)
  const factDiagnostics = [
    ...provenance.diagnostics,
    ...workers.unresolved,
    ...pageMiddleware.unresolved,
    ...generatorPlugins.unresolved,
    ...diRegistrations.unresolvedTokens.map((token): ModuleFactDiagnostic => ({
      code: 'unresolved-static-contract',
      kind: 'di-registration',
      id: token,
      ...(diSourcePath ? { source: { sourcePath: diSourcePath, exportName: token } } : {}),
    })),
  ].sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id),
  )

  const facts: ModuleFacts = {
    module: moduleId,
    title,
    description,
    coreVersion,
    sourcePackage,
    sourceVersion,
    sourceRoot,
    entities,
    events,
    aclFeatures,
    apiRoutes,
    diTokens,
    searchEntities,
    hostTokens,
    notifications,
    cli,
    backendPages,
    frontendPages,
    cliCommands,
    aiTools,
    aiAgents,
    extensionSurfaces,
    ...(provenance.factSources.length > 0 ? { factSources: provenance.factSources } : {}),
    ...(ownedContracts ? { ownedContracts } : {}),
    ...(factDiagnostics.length > 0 ? { factDiagnostics } : {}),
    warnings,
  }

  // Exact unified override targets (spec 2026-08-02-module-facts-exact-override-targets).
  // Adapters consume the fully-populated owned facts + contributions above.
  const overrides = collectModuleOverrideTargets(facts, buildFactSourceLookup(facts))
  if (overrides.overrideTargets.length > 0) facts.overrideTargets = overrides.overrideTargets
  if (overrides.overrideTargetDiagnostics.length > 0) {
    facts.overrideTargetDiagnostics = overrides.overrideTargetDiagnostics
  }
  return facts
}

export interface ModuleFactsJsonEvent {
  id: string
  category: string | null
  entity: string | null
  clientBroadcast?: boolean
  portalBroadcast?: boolean
}

export interface ModuleFactsJsonEntry {
  title: string | null
  description: string | null
  coreVersion: string | null
  sourcePackage: string | null
  sourceVersion: string | null
  sourceRoot: string
  entities: ModuleEntityFact[]
  events: ModuleFactsJsonEvent[]
  aclFeatures: string[]
  apiRoutes: ModuleApiRouteFact[]
  diTokens: string[]
  searchEntities: string[]
  hostTokens: ModuleHostTokens
  notifications: string[]
  cli: string[]
  backendPages: ModulePageFact[]
  frontendPages: ModulePageFact[]
  cliCommands: ModuleCliCommandFact[]
  aiTools: ModuleAiToolFact[]
  aiAgents: ModuleAiAgentFact[]
  extensionSurfaces?: ModuleExtensionSurfaceFacts
  factSources?: ModuleFactSourceEntry[]
  ownedContracts?: ModuleOwnedContracts
  factDiagnostics?: ModuleFactDiagnostic[]
  overrideTargets?: ModuleOverrideTarget[]
  overrideTargetDiagnostics?: ModuleOverrideTargetDiagnostic[]
}

const EMPTY_SECTION_MARKER = '_none_'

function renderVersionStamp(
  coreVersion: string | null,
  sourcePackage: string | null,
  sourceVersion: string | null,
): string {
  if (sourcePackage) {
    return `<!-- generated from ${sourcePackage} ${sourceVersion || '<unknown>'}; core ${coreVersion || '<unknown>'} — R1 staleness stamp -->`
  }
  const version = coreVersion && coreVersion.length > 0 ? coreVersion : '<unknown>'
  return `<!-- generated from @open-mercato/core ${version} — R1 staleness stamp -->`
}

function renderEntitiesSection(entities: ModuleEntityFact[], lookup: FactSourceLookup): string {
  if (entities.length === 0) return `## Entities\n\n${EMPTY_SECTION_MARKER}`
  const header = '| Entity ID | Class | Table | Editable | CustomFields | Source |'
  const divider = '|---|---|---|---|---|---|'
  const rows = entities.map(
    (entity) =>
      `| ${entity.id} | ${entity.class} | ${entity.table} | ${entity.editable ? 'yes' : 'no'} | ${entity.customFields ? 'yes' : 'no'} | ${renderLookedUpSource(lookup, 'entity', entity.id)} |`,
  )
  return ['## Entities', '', header, divider, ...rows].join('\n')
}

function renderEventsSection(events: ModuleEventFact[], lookup: FactSourceLookup): string {
  const heading = `## Events  (${events.length})`
  if (events.length === 0) return `${heading}\n\n${EMPTY_SECTION_MARKER}`
  const header = '| ID | Category | Entity | Browser transport | Source |'
  const divider = '|---|---|---|---|---|'
  const rows = events.map((event) => {
    const transports = [event.clientBroadcast ? 'client' : null, event.portalBroadcast ? 'portal' : null]
      .filter((value): value is string => value !== null)
    return `| ${event.id} | ${event.category ?? '—'} | ${event.entity ?? '—'} | ${transports.join(', ') || '—'} | ${renderLookedUpSource(lookup, 'event', event.id)} |`
  })
  return [heading, '', header, divider, ...rows].join('\n')
}

function renderInlineListSection(heading: string, values: string[]): string {
  if (values.length === 0) return `${heading}\n\n${EMPTY_SECTION_MARKER}`
  return `${heading}\n\n${values.join(' · ')}`
}

function renderSourceLinkedListSection(
  heading: string,
  values: readonly string[],
  lookup: FactSourceLookup,
  kind: ModuleFactSourceKind,
  idColumnLabel: string,
): string {
  if (values.length === 0) return `${heading}\n\n${EMPTY_SECTION_MARKER}`
  const rows = values.map((value) => `| ${value} | ${renderLookedUpSource(lookup, kind, value)} |`)
  return [heading, '', `| ${idColumnLabel} | Source |`, '|---|---|', ...rows].join('\n')
}

/**
 * A generated fact only earns a markdown link when it names an exact module code
 * file. Directory-valued provenance (the module source root, framework hosts that
 * only know their owning package folder) renders as plain text: a link to a folder
 * resolves to nothing in an editor or on the repository browser, so emitting one
 * costs a consumer a dead click instead of taking them to the declaration site.
 */
export function isExactSourceFilePath(sourcePath: string): boolean {
  return MODULE_CODE_EXTENSIONS.some((extension) => sourcePath.endsWith(extension))
}

function renderSourceLink(sourcePath: string): string {
  if (!isExactSourceFilePath(sourcePath)) return sourcePath
  return `[${sourcePath}](../../../${sourcePath})`
}

function renderSourceRefLink(source: ModuleFactSourceRef): string {
  const anchor = source.line ? `#L${source.line}` : ''
  const label = source.line ? `${source.sourcePath}:${source.line}` : source.sourcePath
  if (!isExactSourceFilePath(source.sourcePath)) return label
  return `[${label}](../../../${source.sourcePath}${anchor})`
}


function renderLookedUpSource(lookup: FactSourceLookup, kind: ModuleFactSourceKind, id: string): string {
  const source = lookup(kind, id)
  return source ? renderSourceRefLink(source) : '—'
}

function renderSafeScalar(value: ModuleFactSafeScalar | ModuleFactSafeScalar[] | undefined): string {
  if (value === undefined || value === null) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.map((entry) => String(entry)).join(', ') : '—'
  return String(value)
}

function renderOwnedContractMetadata(metadata: ModuleOwnedContractFact['metadata']): string {
  if (!metadata) return '—'
  const keys = Object.keys(metadata).sort((left, right) => left.localeCompare(right))
  if (keys.length === 0) return '—'
  return keys.map((key) => `${key}=${renderSafeScalar(metadata[key])}`).join('; ')
}

function renderOwnedContractSection(
  heading: string,
  facts: readonly ModuleOwnedContractFact[] | undefined,
): string {
  if (!facts || facts.length === 0) return ''
  const rows = facts.map(
    (fact) => `| ${fact.id} | ${renderOwnedContractMetadata(fact.metadata)} | ${renderSourceRefLink(fact.source)} |`,
  )
  return [heading, '', '| ID | Metadata | Source |', '|---|---|---|', ...rows].join('\n')
}

function renderDiRegistrationsSection(facts: readonly ModuleOwnedContractFact[] | undefined): string {
  if (!facts || facts.length === 0) return ''
  const rows = facts.map((fact) => {
    const metadata = fact.metadata ?? {}
    return `| ${fact.id} | ${renderSafeScalar(metadata.registrationKind)} | ${renderSafeScalar(metadata.lifetime)} | ${renderSafeScalar(metadata.injectionMode)} | ${renderSafeScalar(metadata.providerSymbol)} | ${renderSourceRefLink(fact.source)} |`
  })
  return [
    '## DI registrations (rich)',
    '',
    '| Token | Kind | Lifetime | Injection | Provider | Source |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function describeAuthRule(rule: ApiRouteAuthRule | undefined): string {
  if (!rule) return 'public'
  if (rule.requireFeatures && rule.requireFeatures.length > 0) return rule.requireFeatures.join(', ')
  if (rule.requireRoles && rule.requireRoles.length > 0) return rule.requireRoles.join(', ')
  if (rule.requireAuth) return 'auth'
  return 'public'
}

function renderApiRouteAuthCell(route: ModuleApiRouteFact): string {
  if (route.methods.length === 0) return '—'
  const groups: Array<{ label: string; methods: string[] }> = []
  for (const method of route.methods) {
    const label = describeAuthRule(route.auth[method])
    const existing = groups.find((group) => group.label === label)
    if (existing) existing.methods.push(method)
    else groups.push({ label, methods: [method] })
  }
  return groups.map((group) => `${group.methods.join('/')} → ${group.label}`).join(' · ')
}

function renderApiRoutesSection(routes: ModuleApiRouteFact[]): string {
  if (routes.length === 0) return `## API routes\n\n${EMPTY_SECTION_MARKER}`
  const header = '| Path | Methods | Auth (per-method requireFeatures) | Source |'
  const divider = '|---|---|---|---|'
  const rows = routes.map(
    (route) => `| ${route.path} | ${route.methods.join(' ')} | ${renderApiRouteAuthCell(route)} | ${route.sourcePath ? renderSourceLink(route.sourcePath) : '—'} |`,
  )
  return ['## API routes', '', header, divider, ...rows].join('\n')
}

function renderLinkedFactsSection(
  heading: string,
  facts: ReadonlyArray<{ label: string; sourcePath: string }>,
): string {
  if (facts.length === 0) return `${heading}\n\n${EMPTY_SECTION_MARKER}`
  const rows = facts.map((fact) => `| ${fact.label} | ${renderSourceLink(fact.sourcePath)} |`)
  return [heading, '', '| ID / path | Source |', '|---|---|', ...rows].join('\n')
}

function renderHostTokensSection(hostTokens: ModuleHostTokens): string {
  const entityIdsLine = hostTokens.entityIds.length > 0 ? hostTokens.entityIds.join(' · ') : EMPTY_SECTION_MARKER
  const tableIdsLine = hostTokens.tableIds.length > 0 ? hostTokens.tableIds.join(' · ') : EMPTY_SECTION_MARKER
  return ['## Host extension points', '', `- Entity IDs: ${entityIdsLine}`, `- Table IDs: ${tableIdsLine}`].join('\n')
}

function renderExtensionHostContext(host: ModuleExtensionSurfaceFacts['hosts'][number]): string {
  return host.contextContract ?? host.runtimeContract ?? host.scopeContract ?? '—'
}

function renderExtensionHostSource(host: ModuleExtensionHostFact): string {
  if (host.source.kind === 'fact-ref') return `${host.source.factSection}:${host.source.factKey}`
  return renderSourceRefLink({ sourcePath: host.source.path })
}

function renderExtensionHostsSection(extensionSurfaces: ModuleExtensionSurfaceFacts): string {
  const boundHosts = extensionSurfaces.hosts.filter((host) => host.bound)
  if (boundHosts.length === 0) return `## UMES hosts\n\n${EMPTY_SECTION_MARKER}`
  const rows = boundHosts.map((host) =>
    `| ${host.id} | ${host.family} | ${host.capabilities.join(', ') || '—'} | ${renderExtensionHostContext(host)} | ${host.stability.toUpperCase()} | ${renderExtensionHostSource(host)} |`,
  )
  return [
    '## UMES hosts',
    '',
    '| ID / pattern | Family | Supports | Context | Stability | Source |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function compactContributionDetails(contribution: ModuleExtensionContributionFact): string {
  const details = contribution.details as unknown as Record<string, unknown>
  return Object.keys(details).sort((left, right) => left.localeCompare(right)).flatMap((key) => {
    const value = details[key]
    if (value === undefined) return []
    if (Array.isArray(value)) return [`${key}=${value.join(',') || 'none'}`]
    if (value && typeof value === 'object') {
      const nested = Object.keys(value as Record<string, unknown>).sort((left, right) => left.localeCompare(right)).map((nestedKey) => {
        const nestedValue = (value as Record<string, unknown>)[nestedKey]
        return `${nestedKey}:${Array.isArray(nestedValue) ? nestedValue.join(',') : String(nestedValue)}`
      })
      return [`${key}={${nested.join(';')}}`]
    }
    return [`${key}=${String(value)}`]
  }).join('; ')
}

function renderExtensionContributionsSection(extensionSurfaces: ModuleExtensionSurfaceFacts): string {
  if (extensionSurfaces.contributions.length === 0) return `## UMES contributions\n\n${EMPTY_SECTION_MARKER}`
  const rows = extensionSurfaces.contributions.map((contribution) => {
    const targets = contribution.targets.map((entry) => entry.id).join(', ')
    const resolution = contribution.targets.map((entry) => entry.resolution).join(', ')
    const phases = [...(contribution.phases ?? []), ...(contribution.operations ?? [])].join(', ') || '—'
    const source = renderSourceRefLink({ sourcePath: contribution.source.path })
    return `| ${contribution.id} | ${contribution.kind} | ${targets || '—'} | ${phases} | ${compactContributionDetails(contribution)} | ${resolution || '—'} | ${source} |`
  })
  return [
    '## UMES contributions',
    '',
    '| ID | Kind | Target | Phase / operations | Contract | Resolution | Source |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function renderExtensionDiagnosticsSection(extensionSurfaces: ModuleExtensionSurfaceFacts): string {
  const unbound = extensionSurfaces.hosts.filter((host) => !host.bound)
  if (unbound.length === 0 && extensionSurfaces.unresolved.length === 0) return ''
  const diagnostics = [
    ...unbound.map((host) => `- unbound-helper: ${host.id}`),
    ...extensionSurfaces.unresolved.map((entry) => `- ${entry.reason}: ${entry.key} (${entry.source.path})`),
  ]
  return ['## UMES diagnostics', '', ...diagnostics].join('\n')
}

function renderExtensionTargetRef(target: ModuleExtensionTargetRef): string {
  const method = target.method ? ` ${target.method}` : ''
  const owner = target.moduleId ? ` @${target.moduleId}` : ''
  return `${target.kind}:${target.id}${method}${owner}`
}

function renderActivationBindingsSection(extensionSurfaces: ModuleExtensionSurfaceFacts): string {
  const activations = extensionSurfaces.activations ?? []
  if (activations.length === 0) return `## Active extension bindings\n\n${EMPTY_SECTION_MARKER}`
  const rows = activations.map((activation) => {
    const phases = activation.phases && activation.phases.length > 0 ? activation.phases.join(', ') : '—'
    const source = activation.source ? renderSourceRefLink(activation.source) : '—'
    const bridge = activation.bridge ? `${activation.bridge.factSection}:${activation.bridge.factKey}` : '—'
    return `| ${activation.id} | ${activation.kind} | ${renderExtensionTargetRef(activation.host)} | ${activation.contributionKinds.join(', ') || '—'} | ${phases} | ${bridge} | ${source} |`
  })
  return [
    '## Active extension bindings',
    '',
    '| Activation | Kind | Host | Contribution kinds | Phases | Bridge | Source |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function renderIncomingContributionsSection(extensionSurfaces: ModuleExtensionSurfaceFacts): string {
  const incoming = extensionSurfaces.incoming ?? []
  if (incoming.length === 0) return `## Incoming installed contributions\n\n${EMPTY_SECTION_MARKER}`
  const rows = incoming.map((entry) => {
    const activation = entry.activationId ?? '—'
    const source = entry.source ? renderSourceRefLink(entry.source) : '—'
    return `| ${entry.contributorModuleId} | ${entry.contributionKind} | ${renderExtensionTargetRef(entry.target)} | ${entry.resolution} | ${activation} | ${entry.contributionId} · ${source} |`
  })
  return [
    '## Incoming installed contributions',
    '',
    '| Contributor | Kind | Target | Resolution | Activation | Contribution · Source |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function renderContributionResolutionsSection(
  extensionSurfaces: ModuleExtensionSurfaceFacts,
  lookup: FactSourceLookup,
): string {
  const resolutions = extensionSurfaces.contributionResolutions ?? []
  if (resolutions.length === 0) return `## Contribution resolutions\n\n${EMPTY_SECTION_MARKER}`
  const rows = resolutions.map((resolution) => {
    const activations = resolution.activationIds.length > 0 ? resolution.activationIds.join(', ') : '—'
    const source = renderLookedUpSource(lookup, 'extension-contribution', resolution.contributionId)
    return `| ${resolution.contributionId} | ${renderExtensionTargetRef(resolution.target)} | ${resolution.resolution} | ${activations} | ${source} |`
  })
  return [
    '## Contribution resolutions',
    '',
    '| Contribution | Target | Resolution | Activations | Source |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function renderOverrideTargetPath(target: ModuleOverrideTarget): string {
  let display = 'overrides'
  for (let index = 0; index < target.path.length; index += 1) {
    const segment = target.path[index]
    const isKeyedTerminal = target.key !== undefined && index === target.path.length - 1
    display += isKeyedTerminal ? `[${JSON.stringify(segment)}]` : `.${segment}`
  }
  return display
}

function renderOverrideTargetsSection(targets: readonly ModuleOverrideTarget[] | undefined): string {
  if (!targets || targets.length === 0) return `## Exact override targets\n\n${EMPTY_SECTION_MARKER}`
  const header = '| Domain | Path / key | Supported modes | Referenced fact | Source |'
  const divider = '|---|---|---|---|---|'
  const rows = targets.map((target) => {
    const path = `\`${renderOverrideTargetPath(target)}\``
    const modes = target.modes.join(', ') || '—'
    const fact = `${target.factRef.factSection}:${target.factRef.factKey}`
    return `| ${target.domain} | ${path} | ${modes} | ${fact} | ${renderSourceRefLink(target.source)} |`
  })
  return ['## Exact override targets', '', header, divider, ...rows].join('\n')
}

export function renderModuleFactsMarkdown(facts: ModuleFacts): string {
  const extensionSurfaces = facts.extensionSurfaces ?? { hosts: [], contributions: [], unresolved: [] }
  const lookup = buildFactSourceLookup(facts)
  const sections = [
    `# ${facts.module} — module facts (generated, do not edit)`,
    renderVersionStamp(facts.coreVersion, facts.sourcePackage, facts.sourceVersion),
    `Source root: ${renderSourceLink(facts.sourceRoot)}`,
    '',
    renderEntitiesSection(facts.entities, lookup),
    '',
    renderEventsSection(facts.events, lookup),
    '',
    renderSourceLinkedListSection(
      `## ACL features  (${facts.aclFeatures.length})`,
      facts.aclFeatures,
      lookup,
      'acl-feature',
      'Feature',
    ),
    '',
    renderApiRoutesSection(facts.apiRoutes),
    '',
    renderLinkedFactsSection('## Backend pages', facts.backendPages.map((page) => ({ label: page.path, sourcePath: page.sourcePath }))),
    '',
    renderLinkedFactsSection('## Frontend pages', facts.frontendPages.map((page) => ({ label: page.path, sourcePath: page.sourcePath }))),
    '',
    renderSourceLinkedListSection('## DI service tokens', facts.diTokens, lookup, 'di-registration', 'Token'),
    '',
    renderSourceLinkedListSection('## Search entities', facts.searchEntities, lookup, 'search', 'Entity ID'),
    '',
    renderHostTokensSection(facts.hostTokens),
    '',
    renderExtensionHostsSection(extensionSurfaces),
    '',
    renderExtensionContributionsSection(extensionSurfaces),
    '',
    renderActivationBindingsSection(extensionSurfaces),
    '',
    renderIncomingContributionsSection(extensionSurfaces),
    '',
    renderContributionResolutionsSection(extensionSurfaces, lookup),
    '',
    renderExtensionDiagnosticsSection(extensionSurfaces),
    '',
    renderSourceLinkedListSection('## Notifications', facts.notifications, lookup, 'notification', 'Notification ID'),
    '',
    renderLinkedFactsSection('## CLI commands', facts.cliCommands.map((command) => ({ label: command.command, sourcePath: command.sourcePath }))),
    '',
    renderLinkedFactsSection('## AI tools / MCP capabilities', facts.aiTools.map((tool) => ({ label: tool.name, sourcePath: tool.sourcePath }))),
    '',
    renderLinkedFactsSection('## AI agents', facts.aiAgents.map((agent) => ({ label: agent.id, sourcePath: agent.sourcePath }))),
    '',
    renderOverrideTargetsSection(facts.overrideTargets),
    '',
  ]
  const owned = facts.ownedContracts ?? {}
  const ownedSections = [
    renderOwnedContractSection('## Owned contract — module metadata', owned['module-metadata']),
    renderOwnedContractSection('## Domain commands', owned.command),
    renderOwnedContractSection('## Workers', owned.worker),
    renderOwnedContractSection('## Page middleware', owned['page-middleware']),
    renderOwnedContractSection('## Setup', owned.setup),
    renderOwnedContractSection('## Encryption', owned.encryption),
    renderDiRegistrationsSection(owned['di-registration']),
    renderOwnedContractSection('## Custom entities', owned['custom-entity']),
    renderOwnedContractSection('## AI extensions', owned['ai-extension']),
    renderOwnedContractSection('## Generator plugins', owned['generator-plugin']),
  ].filter((section) => section.length > 0)
  for (const section of ownedSections) {
    sections.push(section, '')
  }
  return sections.join('\n')
}

export function toModuleFactsJsonEntry(facts: ModuleFacts): ModuleFactsJsonEntry {
  return {
    title: facts.title,
    description: facts.description,
    coreVersion: facts.coreVersion,
    sourcePackage: facts.sourcePackage,
    sourceVersion: facts.sourceVersion,
    sourceRoot: facts.sourceRoot,
    entities: facts.entities,
    events: facts.events.map((event) => ({
      id: event.id,
      category: event.category,
      entity: event.entity,
      ...(event.clientBroadcast !== undefined ? { clientBroadcast: event.clientBroadcast } : {}),
      ...(event.portalBroadcast !== undefined ? { portalBroadcast: event.portalBroadcast } : {}),
    })),
    aclFeatures: facts.aclFeatures,
    apiRoutes: facts.apiRoutes,
    diTokens: facts.diTokens,
    searchEntities: facts.searchEntities,
    hostTokens: facts.hostTokens,
    notifications: facts.notifications,
    cli: facts.cli,
    backendPages: facts.backendPages,
    frontendPages: facts.frontendPages,
    cliCommands: facts.cliCommands,
    aiTools: facts.aiTools,
    aiAgents: facts.aiAgents,
    ...(facts.extensionSurfaces ? { extensionSurfaces: facts.extensionSurfaces } : {}),
    ...(facts.factSources && facts.factSources.length > 0 ? { factSources: facts.factSources } : {}),
    ...(facts.ownedContracts && Object.keys(facts.ownedContracts).length > 0
      ? { ownedContracts: facts.ownedContracts }
      : {}),
    ...(facts.factDiagnostics && facts.factDiagnostics.length > 0
      ? { factDiagnostics: facts.factDiagnostics }
      : {}),
    ...(facts.overrideTargets && facts.overrideTargets.length > 0
      ? { overrideTargets: facts.overrideTargets }
      : {}),
    ...(facts.overrideTargetDiagnostics && facts.overrideTargetDiagnostics.length > 0
      ? { overrideTargetDiagnostics: facts.overrideTargetDiagnostics }
      : {}),
  }
}

export function buildModuleFactsJsonObject(
  factsByModule: Record<string, ModuleFacts>,
): Record<string, ModuleFactsJsonEntry> {
  const result: Record<string, ModuleFactsJsonEntry> = {}
  for (const moduleId of Object.keys(factsByModule).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    result[moduleId] = toModuleFactsJsonEntry(factsByModule[moduleId])
  }
  return result
}

export function renderModuleFactsJson(factsByModule: Record<string, ModuleFacts>): string {
  return `${JSON.stringify(buildModuleFactsJsonObject(factsByModule), null, 2)}\n`
}

export interface ExtractAllModuleFactsOptions {
  /**
   * Discovered module sources (auto-discovery path). When provided, each entry's
   * explicit `moduleRoot` is used and `coreSrcRoot`/`moduleIds` are ignored.
   */
  sources?: readonly ModuleFactSource[]
  /** Legacy shared-root path. Used only when `sources` is not provided. */
  coreSrcRoot?: string
  registryPath?: string | null
  registrySource?: string | null
  coreVersion?: string | null
  /** @deprecated Legacy explicit module-id list; only consulted when `sources` is absent. */
  moduleIds?: readonly string[]
}

export interface ExtractAllModuleFactsResult {
  factsByModule: Record<string, ModuleFacts>
  markdownByModule: Record<string, string>
  warnings: string[]
  frameworkMarkdown: string
}

export function extractAllModuleFacts(options: ExtractAllModuleFactsOptions): ExtractAllModuleFactsResult {
  return withModuleExtensionFactExtractionCache(() => extractAllModuleFactsWithCache(options))
}

function extractAllModuleFactsWithCache(options: ExtractAllModuleFactsOptions): ExtractAllModuleFactsResult {
  const sources: ModuleFactSource[] = options.sources
    ? [...options.sources]
    : (options.coreSrcRoot
        ? (options.moduleIds ?? []).map((moduleId) => ({
            moduleId,
            moduleRoot: path.join(options.coreSrcRoot as string, moduleId),
          }))
        : [])

  const factsByModule: Record<string, ModuleFacts> = {}
  const markdownByModule: Record<string, string> = {}
  const warnings: string[] = []
  for (const source of sources) {
    const facts = extractModuleFacts({
      moduleId: source.moduleId,
      moduleRoot: source.moduleRoot,
      coreVersion: options.coreVersion ?? null,
      sourcePackage: source.from ?? null,
      sourceVersion: source.packageVersion ?? null,
      registryPath: options.registryPath ?? null,
      registrySource: options.registrySource ?? null,
    })
    factsByModule[source.moduleId] = facts
    warnings.push(...facts.warnings)
  }
  const surfacesByModule = Object.fromEntries(
    Object.entries(factsByModule).map(([moduleId, facts]) => [
      moduleId,
      facts.extensionSurfaces ?? { hosts: [], contributions: [], unresolved: [] },
    ]),
  )
  const correlated = correlateModuleExtensionFacts({
    surfacesByModule,
    entityIds: new Set(Object.values(factsByModule).flatMap((facts) => facts.entities.map((entity) => entity.id))),
    eventIds: new Set(Object.values(factsByModule).flatMap((facts) => facts.events.map((event) => event.id))),
    apiRoutes: new Set([
      ...Object.values(factsByModule).flatMap((facts) => facts.apiRoutes.map((route) => route.path)),
      ...sources.flatMap((source) => extractKnownApiRouteIds(source.moduleId, source.moduleRoot)),
    ]),
    commandIds: new Set(sources.flatMap((source) => extractKnownCommandIds(source.moduleId, source.moduleRoot))),
  })
  assertNoUnresolvedExtensionTargets(correlated)
  const apiRouteOwners = new Map<string, {
    moduleId: string
    source: ModuleFactSourceRef
    bridges: ApiRouteInterceptorBridge[]
  }>()
  const commandOwners = new Map<string, { moduleId: string; source: ModuleFactSourceRef }>()
  for (const source of [...sources].sort((left, right) => left.moduleId.localeCompare(right.moduleId))) {
    const facts = factsByModule[source.moduleId]
    const sourceRoot = facts ? facts.sourceRoot : source.moduleId
    const owners = extractActivationTargetOwners({
      moduleId: source.moduleId,
      moduleRoot: source.moduleRoot,
      sourceRoot,
    })
    for (const route of owners.apiRoutes) {
      if (!apiRouteOwners.has(route.id)) {
        apiRouteOwners.set(route.id, { moduleId: source.moduleId, source: route.source, bridges: route.bridges })
      }
    }
    for (const command of owners.commands) {
      if (!commandOwners.has(command.id)) commandOwners.set(command.id, { moduleId: source.moduleId, source: command.source })
    }
  }
  const withIncoming = correlateIncomingExtensions({
    surfacesByModule: correlated,
    apiRouteOwners,
    commandOwners,
  })
  for (const moduleId of Object.keys(factsByModule).sort((left, right) => left.localeCompare(right))) {
    factsByModule[moduleId].extensionSurfaces = withIncoming[moduleId]
    markdownByModule[moduleId] = renderModuleFactsMarkdown(factsByModule[moduleId])
    warnings.push(...correlated[moduleId].unresolved.map((entry) =>
      `[module-facts] ${moduleId} ${entry.reason}: ${entry.key} (${entry.source.path})`,
    ))
  }
  return { factsByModule, markdownByModule, warnings, frameworkMarkdown: renderFrameworkExtensionPointsMarkdown() }
}
