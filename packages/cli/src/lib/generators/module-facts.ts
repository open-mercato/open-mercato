import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { toSnake } from '../utils'

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
}

export interface ModuleEventFact {
  id: string
  label?: string
  category: string | null
  entity: string | null
}

export interface ModuleHostTokens {
  entityIds: string[]
  tableIds: string[]
}

export interface ModuleFacts {
  module: string
  coreVersion: string | null
  entities: ModuleEntityFact[]
  events: ModuleEventFact[]
  aclFeatures: string[]
  apiRoutes: ModuleApiRouteFact[]
  diTokens: string[]
  searchEntities: string[]
  hostTokens: ModuleHostTokens
  notifications: string[]
  cli: string[]
  warnings: string[]
}

export interface ExtractModuleFactsOptions {
  moduleId: string
  coreSrcRoot: string
  coreVersion?: string | null
  registryPath?: string | null
  registrySource?: string | null
}

export const MODULE_FACTS_ALLOWLIST = [
  'auth',
  'catalog',
  'currencies',
  'customer_accounts',
  'customers',
  'data_sync',
  'integrations',
  'sales',
  'workflows',
] as const

export type ModuleFactsModuleId = (typeof MODULE_FACTS_ALLOWLIST)[number]

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

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const id = readStringPropertyInitializer(node, 'id')
      if (id && id.includes(':')) result.add(id)
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
    if (label !== undefined) fact.label = label
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

  return { path: routePath, methods, auth }
}

function extractApiRoutes(
  moduleId: string,
  registrySource: string | null,
  registryDescription: string,
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
            routes.push(route)
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
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFilesRecursive(fullPath))
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

function extractTableIds(backendDir: string): string[] {
  if (!fs.existsSync(backendDir)) return []

  const tableIds: string[] = []
  const seen = new Set<string>()
  for (const filePath of listSourceFilesRecursive(backendDir)) {
    const sourceFile = readSourceFile(filePath)
    if (!sourceFile) continue
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const propertyName = getPropertyName(node)
        if (
          (propertyName === 'tableId' || propertyName === 'extensionTableId') &&
          ts.isStringLiteralLike(node.initializer)
        ) {
          const value = node.initializer.text
          if (value && !seen.has(value)) {
            seen.add(value)
            tableIds.push(value)
          }
        }
      }
      node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)
  }
  tableIds.sort()
  return tableIds
}

function extractHostEntityIds(entities: ModuleEntityFact[]): string[] {
  return entities.filter((entity) => entity.id.endsWith('_entity')).map((entity) => entity.id)
}

export function extractModuleFacts(options: ExtractModuleFactsOptions): ModuleFacts {
  const { moduleId, coreSrcRoot, coreVersion = null } = options
  const moduleRoot = path.join(coreSrcRoot, moduleId)

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
  const backendDir = path.join(moduleRoot, 'backend')

  const warnings: string[] = []
  const customFieldEntityIds = collectCustomFieldEntityIds(ceFilePath)
  const entities = extractEntities(moduleId, entitiesFilePath, customFieldEntityIds)
  const events = extractEvents(eventsFilePath)
  const aclFeatures = extractAclFeatures(aclFilePath)

  const { source: registrySource, description: registryDescription } = resolveRegistrySource(options)
  const apiRoutes = extractApiRoutes(moduleId, registrySource, registryDescription, warnings)
  const diTokens = extractDiTokens(diFilePath)
  const searchEntities = extractSearchEntities(searchFilePath, warnings)
  const notifications = extractNotifications(notificationsFilePath, warnings)
  const cli = extractCli(cliFilePath, warnings)
  const hostTokens: ModuleHostTokens = {
    entityIds: extractHostEntityIds(entities),
    tableIds: extractTableIds(backendDir),
  }

  return {
    module: moduleId,
    coreVersion,
    entities,
    events,
    aclFeatures,
    apiRoutes,
    diTokens,
    searchEntities,
    hostTokens,
    notifications,
    cli,
    warnings,
  }
}
