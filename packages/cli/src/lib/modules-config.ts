import fs from 'node:fs'
import ts from 'typescript'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
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

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue

    if (property.name.text === 'id' && ts.isStringLiteralLike(property.initializer)) {
      id = property.initializer.text
    }

    if (property.name.text === 'from' && ts.isStringLiteralLike(property.initializer)) {
      from = property.initializer.text
    }
  }

  if (!id) return null

  return {
    id,
    from: from ?? '@open-mercato/core',
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

    occurrences.push(...collectPushEntriesFromStatement(statement, env, variableName, scope))
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
  }
}

function escapeSingleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function buildModuleEntryLiteral(entry: ModuleEntry): string {
  const normalized = normalizeModuleEntry(entry)
  return `{ id: '${escapeSingleQuotedString(normalized.id)}', from: '${escapeSingleQuotedString(normalized.from ?? '@open-mercato/core')}' }`
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

function upsertModuleSource(objectLiteral: string, from: string): string {
  if (/from\s*:\s*'[^']*'/.test(objectLiteral)) {
    return objectLiteral.replace(/from\s*:\s*'[^']*'/, `from: '${escapeSingleQuotedString(from)}'`)
  }

  if (/from\s*:\s*"[^"]*"/.test(objectLiteral)) {
    return objectLiteral.replace(/from\s*:\s*"[^"]*"/, `from: "${from.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  }

  return objectLiteral.replace(/\}\s*$/, `, from: '${escapeSingleQuotedString(from)}' }`)
}

export function ensureModuleRegistration(
  modulesPath: string,
  entry: ModuleEntry,
): { changed: boolean; registeredAs: string } {
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules.ts not found at ${modulesPath}`)
  }

  const source = fs.readFileSync(modulesPath, 'utf8')
  const sourceFile = ts.createSourceFile('modules.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const config = parseModuleConfigShape(source)
  const normalized = normalizeModuleEntry(entry)
  const matches = config.occurrences.filter((occurrence) => occurrence.entry.id === normalized.id)

  if (matches.length > 1) {
    throw new Error(
      `Module "${normalized.id}" is registered multiple times in ${modulesPath}. Resolve duplicates manually before running this command.`,
    )
  }

  if (matches.length === 1) {
    const existing = normalizeModuleEntry(matches[0].entry)
    if (existing.from === normalized.from) {
      return { changed: false, registeredAs: normalized.from ?? '@open-mercato/core' }
    }

    throw new Error(
      `Module "${normalized.id}" is already registered from "${existing.from}". Remove or eject the existing registration first.`,
    )
  }

  const updated = replaceArrayLiteral(source, config.arrayNode, normalized, sourceFile)
  fs.writeFileSync(modulesPath, updated)

  return { changed: true, registeredAs: normalized.from ?? '@open-mercato/core' }
}

export function setModuleRegistrationSource(
  modulesPath: string,
  moduleId: string,
  from: string,
): { changed: boolean } {
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules.ts not found at ${modulesPath}`)
  }

  const source = fs.readFileSync(modulesPath, 'utf8')
  const config = parseModuleConfigShape(source)
  const matches = config.occurrences.filter((occurrence) => occurrence.entry.id === moduleId)

  if (matches.length === 0) {
    throw new Error(
      `Could not find module entry for "${moduleId}" in ${modulesPath}. Expected a pattern like: { id: '${moduleId}', from: '...' } or { id: '${moduleId}' }`,
    )
  }

  if (matches.length > 1) {
    throw new Error(
      `Module "${moduleId}" is registered multiple times in ${modulesPath}. Resolve duplicates manually before running this command.`,
    )
  }

  const match = matches[0]
  const current = normalizeModuleEntry(match.entry)
  if (current.from === from) {
    return { changed: false }
  }

  const objectLiteral = source.slice(match.node.getStart(), match.node.end)
  const updatedObjectLiteral = upsertModuleSource(objectLiteral, from)
  const updated =
    source.slice(0, match.node.getStart()) +
    updatedObjectLiteral +
    source.slice(match.node.end)

  fs.writeFileSync(modulesPath, updated)

  return { changed: true }
}
