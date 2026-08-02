import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import type { ModuleExtensionContributionFact, ModuleExtensionSurfaceFacts } from '@open-mercato/shared/modules/widgets/extension-points'
import { toSnake } from '../utils'
import {
  assertNoUnresolvedExtensionTargets,
  correlateModuleExtensionFacts,
  extractKnownApiRouteIds,
  extractKnownCommandIds,
  extractModuleExtensionFacts,
  renderFrameworkExtensionPointsMarkdown,
  withModuleExtensionFactExtractionCache,
} from './module-extension-facts'

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

export interface ModulePageFact {
  path: string
  sourcePath: string
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
    if (!isModernPage && (fileStem.endsWith('.meta') || /^[A-Z]/.test(fileStem))) continue
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
    pages.push({
      path: routePath,
      sourcePath: toPortableSourcePath(moduleRoot, sourceRoot, filePath),
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

  const warnings: string[] = []
  const { title, description } = extractModuleMeta(indexFilePath)
  const customFieldEntityIds = collectCustomFieldEntityIds(ceFilePath)
  const entities = extractEntities(moduleId, entitiesFilePath, customFieldEntityIds)
  const events = extractEvents(eventsFilePath)
  const aclFeatures = extractAclFeatures(aclFilePath)

  const { source: registrySource, description: registryDescription } = resolveRegistrySource(options)
  const apiRouteSourcePaths = extractApiRouteSourcePaths(moduleId, moduleRoot, sourceRoot)
  const apiRoutes = extractApiRoutes(moduleId, registrySource, registryDescription, apiRouteSourcePaths, warnings)
  const diTokens = extractDiTokens(diFilePath)
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

  return {
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
    warnings,
  }
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

function renderEntitiesSection(entities: ModuleEntityFact[]): string {
  if (entities.length === 0) return `## Entities\n\n${EMPTY_SECTION_MARKER}`
  const header = '| Entity ID | Class | Table | Editable | CustomFields |'
  const divider = '|---|---|---|---|---|'
  const rows = entities.map(
    (entity) =>
      `| ${entity.id} | ${entity.class} | ${entity.table} | ${entity.editable ? 'yes' : 'no'} | ${entity.customFields ? 'yes' : 'no'} |`,
  )
  return ['## Entities', '', header, divider, ...rows].join('\n')
}

function renderEventsSection(events: ModuleEventFact[]): string {
  const heading = `## Events  (${events.length})`
  if (events.length === 0) return `${heading}\n\n${EMPTY_SECTION_MARKER}`
  const header = '| ID | Category | Entity | Browser transport |'
  const divider = '|---|---|---|---|'
  const rows = events.map((event) => {
    const transports = [event.clientBroadcast ? 'client' : null, event.portalBroadcast ? 'portal' : null]
      .filter((value): value is string => value !== null)
    return `| ${event.id} | ${event.category ?? '—'} | ${event.entity ?? '—'} | ${transports.join(', ') || '—'} |`
  })
  return [heading, '', header, divider, ...rows].join('\n')
}

function renderInlineListSection(heading: string, values: string[]): string {
  if (values.length === 0) return `${heading}\n\n${EMPTY_SECTION_MARKER}`
  return `${heading}\n\n${values.join(' · ')}`
}

function renderSourceLink(sourcePath: string): string {
  return `[${sourcePath}](../../../${sourcePath})`
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

function renderExtensionHostsSection(extensionSurfaces: ModuleExtensionSurfaceFacts): string {
  const boundHosts = extensionSurfaces.hosts.filter((host) => host.bound)
  if (boundHosts.length === 0) return `## UMES hosts\n\n${EMPTY_SECTION_MARKER}`
  const rows = boundHosts.map((host) =>
    `| ${host.id} | ${host.family} | ${host.capabilities.join(', ') || '—'} | ${renderExtensionHostContext(host)} | ${host.stability.toUpperCase()} |`,
  )
  return [
    '## UMES hosts',
    '',
    '| ID / pattern | Family | Supports | Context | Stability |',
    '|---|---|---|---|---|',
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
    return `| ${contribution.id} | ${contribution.kind} | ${targets || '—'} | ${phases} | ${compactContributionDetails(contribution)} | ${resolution || '—'} |`
  })
  return [
    '## UMES contributions',
    '',
    '| ID | Kind | Target | Phase / operations | Contract | Resolution |',
    '|---|---|---|---|---|---|',
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

export function renderModuleFactsMarkdown(facts: ModuleFacts): string {
  const extensionSurfaces = facts.extensionSurfaces ?? { hosts: [], contributions: [], unresolved: [] }
  const sections = [
    `# ${facts.module} — module facts (generated, do not edit)`,
    renderVersionStamp(facts.coreVersion, facts.sourcePackage, facts.sourceVersion),
    `Source root: ${renderSourceLink(facts.sourceRoot)}`,
    '',
    renderEntitiesSection(facts.entities),
    '',
    renderEventsSection(facts.events),
    '',
    renderInlineListSection(`## ACL features  (${facts.aclFeatures.length})`, facts.aclFeatures),
    '',
    renderApiRoutesSection(facts.apiRoutes),
    '',
    renderLinkedFactsSection('## Backend pages', facts.backendPages.map((page) => ({ label: page.path, sourcePath: page.sourcePath }))),
    '',
    renderLinkedFactsSection('## Frontend pages', facts.frontendPages.map((page) => ({ label: page.path, sourcePath: page.sourcePath }))),
    '',
    renderInlineListSection('## DI service tokens', facts.diTokens),
    '',
    renderInlineListSection('## Search entities', facts.searchEntities),
    '',
    renderHostTokensSection(facts.hostTokens),
    '',
    renderExtensionHostsSection(extensionSurfaces),
    '',
    renderExtensionContributionsSection(extensionSurfaces),
    '',
    renderExtensionDiagnosticsSection(extensionSurfaces),
    '',
    renderInlineListSection('## Notifications', facts.notifications),
    '',
    renderLinkedFactsSection('## CLI commands', facts.cliCommands.map((command) => ({ label: command.command, sourcePath: command.sourcePath }))),
    '',
    renderLinkedFactsSection('## AI tools / MCP capabilities', facts.aiTools.map((tool) => ({ label: tool.name, sourcePath: tool.sourcePath }))),
    '',
    renderLinkedFactsSection('## AI agents', facts.aiAgents.map((agent) => ({ label: agent.id, sourcePath: agent.sourcePath }))),
    '',
  ]
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
  for (const moduleId of Object.keys(factsByModule).sort((left, right) => left.localeCompare(right))) {
    factsByModule[moduleId].extensionSurfaces = correlated[moduleId]
    markdownByModule[moduleId] = renderModuleFactsMarkdown(factsByModule[moduleId])
    warnings.push(...correlated[moduleId].unresolved.map((entry) =>
      `[module-facts] ${moduleId} ${entry.reason}: ${entry.key} (${entry.source.path})`,
    ))
  }
  return { factsByModule, markdownByModule, warnings, frameworkMarkdown: renderFrameworkExtensionPointsMarkdown() }
}
