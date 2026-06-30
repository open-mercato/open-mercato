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
  category: string | null
  entity: string | null
}

export interface ModuleDiTokenFact {
  token: string
  kind: string
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
  diTokens: ModuleDiTokenFact[]
  searchEntities: string[]
  hostTokens: ModuleHostTokens
  notifications: string[]
  cli: string[]
}

export interface ExtractModuleFactsOptions {
  moduleId: string
  coreSrcRoot: string
  coreVersion?: string | null
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
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
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

export function extractModuleFacts(options: ExtractModuleFactsOptions): ModuleFacts {
  const { moduleId, coreSrcRoot, coreVersion = null } = options
  const moduleRoot = path.join(coreSrcRoot, moduleId)

  const entitiesFilePath =
    resolveConventionFile(path.join(moduleRoot, 'data'), 'entities') ??
    resolveConventionFile(path.join(moduleRoot, 'db'), 'entities') ??
    resolveConventionFile(path.join(moduleRoot, 'data'), 'schema')
  const ceFilePath = resolveConventionFile(moduleRoot, 'ce')

  const customFieldEntityIds = collectCustomFieldEntityIds(ceFilePath)
  const entities = extractEntities(moduleId, entitiesFilePath, customFieldEntityIds)

  return {
    module: moduleId,
    coreVersion,
    entities,
    events: [],
    aclFeatures: [],
    apiRoutes: [],
    diTokens: [],
    searchEntities: [],
    hostTokens: { entityIds: [], tableIds: [] },
    notifications: [],
    cli: [],
  }
}
