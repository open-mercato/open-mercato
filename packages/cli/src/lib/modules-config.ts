import fs from 'node:fs'
import ts from 'typescript-js'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  locator?: string
  packageName?: string
}

type ModuleOccurrence = {
  entry: ModuleEntry
  node: ts.ObjectLiteralExpression
}

type ModuleConfigShape = {
  arrayNode: ts.ArrayLiteralExpression
  occurrences: ModuleOccurrence[]
}

function parseModuleEntryFromObjectLiteral(node: ts.ObjectLiteralExpression): ModuleEntry | null {
  let id: string | null = null
  let from: string | null = null
  let locator: string | undefined
  let packageName: string | undefined

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name))) continue

    if (property.name.text === 'id' && ts.isStringLiteralLike(property.initializer)) {
      id = property.initializer.text
    }

    if (property.name.text === 'packageName' && ts.isStringLiteralLike(property.initializer)) {
      packageName = property.initializer.text
    }

    if (property.name.text === 'locator' && ts.isStringLiteralLike(property.initializer)) {
      locator = property.initializer.text
    }

    if (property.name.text === 'from' && ts.isStringLiteralLike(property.initializer)) {
      from = property.initializer.text
    }
  }

  if (!id) return null

  return {
    id,
    from: from ?? '@open-mercato/core',
    ...(locator ? { locator } : {}),
    ...(packageName ? { packageName } : {}),
  }
}

function parseProcessEnvAccess(
  node: ts.Expression,
  env: NodeJS.ProcessEnv,
): { matched: boolean; value: string | undefined } {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const target = node.expression
    if (
      ts.isPropertyAccessExpression(target)
      && ts.isIdentifier(target.expression)
      && target.expression.text === 'process'
      && target.name.text === 'env'
    ) {
      return { matched: true, value: env[node.name.text] }
    }
  }

  if (
    ts.isElementAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
    && node.expression.name.text === 'env'
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return { matched: true, value: env[node.argumentExpression.text] }
  }

  return { matched: false, value: undefined }
}

function evaluateStaticExpressionWithScope(
  node: ts.Expression,
  env: NodeJS.ProcessEnv,
  scope: Map<string, unknown>,
): unknown {
  if (ts.isParenthesizedExpression(node)) {
    return evaluateStaticExpressionWithScope(node.expression, env, scope)
  }

  if (ts.isIdentifier(node)) {
    return scope.get(node.text)
  }

  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  if (ts.isNumericLiteral(node)) {
    return Number(node.text)
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null

  const envAccess = parseProcessEnvAccess(node, env)
  if (envAccess.matched) {
    return envAccess.value
  }

  if (ts.isPropertyAccessExpression(node)) {
    const target = evaluateStaticExpressionWithScope(node.expression, env, scope)
    if (target && typeof target === 'object' && node.name.text in target) {
      return (target as Record<string, unknown>)[node.name.text]
    }
    return undefined
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return !Boolean(evaluateStaticExpressionWithScope(node.operand, env, scope))
  }

  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return Boolean(evaluateStaticExpressionWithScope(node.left, env, scope))
        && Boolean(evaluateStaticExpressionWithScope(node.right, env, scope))
    }

    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return Boolean(evaluateStaticExpressionWithScope(node.left, env, scope))
        || Boolean(evaluateStaticExpressionWithScope(node.right, env, scope))
    }

    if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      return evaluateStaticExpressionWithScope(node.left, env, scope)
        === evaluateStaticExpressionWithScope(node.right, env, scope)
    }

    if (node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
      return evaluateStaticExpressionWithScope(node.left, env, scope)
        !== evaluateStaticExpressionWithScope(node.right, env, scope)
    }
  }

  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'parseBooleanWithDefault'
  ) {
    const rawValueNode = node.arguments[0]
    const fallbackNode = node.arguments[1]
    const rawValue = rawValueNode
      ? evaluateStaticExpressionWithScope(rawValueNode, env, scope)
      : undefined
    const fallbackValue = fallbackNode
      ? evaluateStaticExpressionWithScope(fallbackNode, env, scope)
      : false

    return parseBooleanWithDefault(
      typeof rawValue === 'string' ? rawValue : undefined,
      Boolean(fallbackValue),
    )
  }

  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'some'
  ) {
    const target = evaluateStaticExpressionWithScope(node.expression.expression, env, scope)
    const predicate = node.arguments[0]
    if (!Array.isArray(target) || !predicate) {
      return undefined
    }

    return target.some((entry) => {
      if (!ts.isArrowFunction(predicate) && !ts.isFunctionExpression(predicate)) {
        return false
      }

      const localScope = new Map(scope)
      const parameter = predicate.parameters[0]
      if (parameter && ts.isIdentifier(parameter.name)) {
        localScope.set(parameter.name.text, entry)
      }

      if (ts.isBlock(predicate.body)) {
        const returnStatement = predicate.body.statements.find((statement): statement is ts.ReturnStatement =>
          ts.isReturnStatement(statement),
        )
        if (!returnStatement?.expression) {
          return false
        }
        return Boolean(evaluateStaticExpressionWithScope(returnStatement.expression, env, localScope))
      }

      return Boolean(evaluateStaticExpressionWithScope(predicate.body, env, localScope))
    })
  }

  return undefined
}

function evaluateStaticCondition(
  node: ts.Expression,
  env: NodeJS.ProcessEnv,
  scope: Map<string, unknown>,
): boolean {
  return Boolean(evaluateStaticExpressionWithScope(node, env, scope))
}

function collectPushEntriesFromStatement(
  statement: ts.Statement,
  env: NodeJS.ProcessEnv,
  targetVariableName: string,
  scope: Map<string, unknown>,
): ModuleOccurrence[] {
  if (ts.isBlock(statement)) {
    return statement.statements.flatMap((child) =>
      collectPushEntriesFromStatement(child, env, targetVariableName, scope),
    )
  }

  if (ts.isIfStatement(statement)) {
    if (evaluateStaticCondition(statement.expression, env, scope)) {
      return collectPushEntriesFromStatement(statement.thenStatement, env, targetVariableName, scope)
    }

    if (statement.elseStatement) {
      return collectPushEntriesFromStatement(statement.elseStatement, env, targetVariableName, scope)
    }

    return []
  }

  if (!ts.isExpressionStatement(statement)) return []

  const expression = statement.expression
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return []
  }

  const pushTarget = expression.expression.expression
  const pushMethod = expression.expression.name

  if (!ts.isIdentifier(pushTarget) || pushTarget.text !== targetVariableName || pushMethod.text !== 'push') {
    return []
  }

  return expression.arguments.flatMap((argument) => {
    if (!ts.isObjectLiteralExpression(argument)) return []
    const entry = parseModuleEntryFromObjectLiteral(argument)
    return entry ? [{ entry, node: argument }] : []
  })
}

function parseModuleConfigShape(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): ModuleConfigShape {
  const sourceFile = ts.createSourceFile('modules.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const variableName = 'enabledModules'
  const occurrences: ModuleOccurrence[] = []
  const scope = new Map<string, unknown>()
  let arrayNode: ts.ArrayLiteralExpression | null = null
  let foundDeclaration = false

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue

        if (declaration.name.text === variableName) {
          if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue

          arrayNode = declaration.initializer
          occurrences.push(...declaration.initializer.elements.flatMap((element) => {
            if (!ts.isObjectLiteralExpression(element)) return []
            const entry = parseModuleEntryFromObjectLiteral(element)
            return entry ? [{ entry, node: element }] : []
          }))
          scope.set(variableName, occurrences.map((occurrence) => occurrence.entry))
          foundDeclaration = true
          continue
        }

        if (!declaration.initializer) continue

        scope.set(
          declaration.name.text,
          evaluateStaticExpressionWithScope(declaration.initializer, env, scope),
        )
      }
      continue
    }

    if (!foundDeclaration) continue

    const pushedOccurrences = collectPushEntriesFromStatement(statement, env, variableName, scope)
    if (pushedOccurrences.length > 0) {
      occurrences.push(...pushedOccurrences)
      scope.set(variableName, occurrences.map((occurrence) => occurrence.entry))
    }
  }

  if (!arrayNode) {
    throw new Error('Could not find enabledModules array declaration in src/modules.ts')
  }

  return { arrayNode, occurrences }
}

function normalizeModuleEntry(entry: ModuleEntry): ModuleEntry {
  return {
    id: entry.id,
    from: entry.from ?? '@open-mercato/core',
    ...(entry.locator ? { locator: entry.locator } : {}),
    ...(entry.packageName ? { packageName: entry.packageName } : {}),
  }
}

function escapeSingleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function buildModuleEntryLiteral(entry: ModuleEntry): string {
  const normalized = normalizeModuleEntry(entry)
  return `{ id: '${escapeSingleQuotedString(normalized.id)}', from: '${escapeSingleQuotedString(normalized.from ?? '@open-mercato/core')}'${normalized.locator ? `, locator: '${escapeSingleQuotedString(normalized.locator)}'` : ''}${normalized.packageName ? `, packageName: '${escapeSingleQuotedString(normalized.packageName)}'` : ''} }`
}

function lineIndentAt(source: string, position: number): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const lineToPosition = source.slice(lineStart, position)
  const match = lineToPosition.match(/^\s*/)
  return match?.[0] ?? ''
}

function replaceArrayLiteral(
  source: string,
  arrayNode: ts.ArrayLiteralExpression,
  entry: ModuleEntry,
  sourceFile: ts.SourceFile,
): string {
  const existingElements = arrayNode.elements.map((element) =>
    source.slice(element.getStart(sourceFile), element.end).trim(),
  )
  const closingIndent = lineIndentAt(source, arrayNode.end - 1)
  const elementIndent =
    arrayNode.elements.length > 0
      ? lineIndentAt(source, arrayNode.elements[0].getStart(sourceFile))
      : `${closingIndent}  `
  const updatedArray = [
    '[',
    ...[...existingElements, buildModuleEntryLiteral(entry)].map((value) => `${elementIndent}${value},`),
    `${closingIndent}]`,
  ].join('\n')

  return source.slice(0, arrayNode.getStart(sourceFile)) + updatedArray + source.slice(arrayNode.end)
}

function upsertModuleProperty(objectLiteral: string, propertyName: 'from' | 'locator' | 'packageName', value: string): string {
  const prefix = 'const entry = '
  const sourceFile = ts.createSourceFile('entry.ts', prefix + objectLiteral, ts.ScriptTarget.Latest, true)
  const statement = sourceFile.statements[0]
  const initializer = ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.initializer : undefined
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error('Cannot update module registration: expected an object literal.')
  }
  const property = initializer.properties.find((candidate) =>
    'name' in candidate && candidate.name && (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)) && candidate.name.text === propertyName,
  )
  const quotedValue = `'${escapeSingleQuotedString(value)}'`
  if (property) {
    const target = ts.isPropertyAssignment(property) ? property.initializer : property
    const existingQuote = ts.isPropertyAssignment(property) ? property.initializer.getText(sourceFile)[0] : undefined
    const replacementValue = existingQuote === '"' ? JSON.stringify(value) : quotedValue
    const replacement = ts.isPropertyAssignment(property) ? replacementValue : `${propertyName}: ${replacementValue}`
    return objectLiteral.slice(0, target.getStart(sourceFile) - prefix.length) + replacement + objectLiteral.slice(target.end - prefix.length)
  }
  const lastProperty = initializer.properties[initializer.properties.length - 1]
  const insertPosition = lastProperty ? lastProperty.end - prefix.length : initializer.end - prefix.length - 1
  const separator = lastProperty ? ', ' : ' '
  return objectLiteral.slice(0, insertPosition) + `${separator}${propertyName}: ${quotedValue}` + objectLiteral.slice(insertPosition)
}

export function ensureModuleRegistration(
  modulesPath: string,
  entry: ModuleEntry,
): { changed: boolean; registeredAs: string } {
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules.ts not found at ${modulesPath}`)
  }

  const source = fs.readFileSync(modulesPath, 'utf8')
  const result = prepareModuleRegistration(source, entry)
  if (result.changed) fs.writeFileSync(modulesPath, result.source)
  return { changed: result.changed, registeredAs: result.registeredAs }
}

export function prepareModuleRegistration(
  source: string,
  entry: ModuleEntry,
): { source: string; changed: boolean; registeredAs: string } {
  const sourceFile = ts.createSourceFile('modules.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const config = parseModuleConfigShape(source)
  const normalized = normalizeModuleEntry(entry)
  const matches = config.occurrences.filter((occurrence) => occurrence.entry.id === normalized.id)

  if (matches.length > 1) {
    throw new Error(`Module "${normalized.id}" is registered multiple times in src/modules.ts. Resolve duplicates manually before running this command.`)
  }

  if (matches.length === 1) {
    const existing = normalizeModuleEntry(matches[0].entry)
    if (existing.from === normalized.from) {
      return { source, changed: false, registeredAs: normalized.from ?? '@open-mercato/core' }
    }
    throw new Error(`Module "${normalized.id}" is already registered from "${existing.from}". Remove or eject the existing registration first.`)
  }

  return {
    source: replaceArrayLiteral(source, config.arrayNode, normalized, sourceFile),
    changed: true,
    registeredAs: normalized.from ?? '@open-mercato/core',
  }
}

export function setModuleRegistrationSource(
  modulesPath: string,
  moduleId: string,
  from: string,
  provenance?: Pick<ModuleEntry, 'locator' | 'packageName'>,
): { changed: boolean } {
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules.ts not found at ${modulesPath}`)
  }

  const source = fs.readFileSync(modulesPath, 'utf8')
  const updated = prepareModuleRegistrationSource(source, moduleId, from, provenance)
  if (updated === source) return { changed: false }
  fs.writeFileSync(modulesPath, updated)
  return { changed: true }
}

export function prepareModuleRegistrationSource(
  source: string,
  moduleId: string,
  from: string,
  provenance?: Pick<ModuleEntry, 'locator' | 'packageName'>,
): string {
  const config = parseModuleConfigShape(source)
  const matches = config.occurrences.filter((occurrence) => occurrence.entry.id === moduleId)

  if (matches.length === 0) {
    throw new Error(
      `Could not find module entry for "${moduleId}" in src/modules.ts. Expected a pattern like: { id: '${moduleId}', from: '...' } or { id: '${moduleId}' }`,
    )
  }

  if (matches.length > 1) {
    throw new Error(
      `Module "${moduleId}" is registered multiple times in src/modules.ts. Resolve duplicates manually before running this command.`,
    )
  }

  const match = matches[0]
  const current = normalizeModuleEntry(match.entry)
  if (current.from === from && (!provenance?.locator || current.locator === provenance.locator) && (!provenance?.packageName || current.packageName === provenance.packageName)) {
    return source
  }

  const objectLiteral = source.slice(match.node.getStart(), match.node.end)
  let updatedObjectLiteral = upsertModuleProperty(objectLiteral, 'from', from)
  if (provenance?.locator) updatedObjectLiteral = upsertModuleProperty(updatedObjectLiteral, 'locator', provenance.locator)
  if (provenance?.packageName) updatedObjectLiteral = upsertModuleProperty(updatedObjectLiteral, 'packageName', provenance.packageName)
  const updated =
    source.slice(0, match.node.getStart()) +
    updatedObjectLiteral +
    source.slice(match.node.end)

  return updated
}
