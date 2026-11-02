import fs from 'node:fs'
import ts from 'typescript-js'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
}

type ModuleOccurrence = {
  entry: ModuleEntry
  node: ts.ObjectLiteralExpression
  active: boolean
  envFlags: string[] | null
}

type EnvFlagScope = Map<string, string[] | null>

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

function readProcessEnvName(node: ts.Expression): string | null {
  if (
    ts.isPropertyAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
    && node.expression.name.text === 'env'
  ) {
    return node.name.text
  }

  if (
    ts.isElementAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
    && node.expression.name.text === 'env'
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text
  }

  return null
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

  const envName = readProcessEnvName(node)
  if (envName) {
    return env[envName]
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

function mergeEnvFlags(left: string[] | null, right: string[] | null): string[] | null {
  if (left === null || right === null) return null
  return Array.from(new Set([...left, ...right]))
}

function collectEnablingEnvFlags(node: ts.Expression, envFlagScope: EnvFlagScope): string[] | null {
  if (ts.isParenthesizedExpression(node)) {
    return collectEnablingEnvFlags(node.expression, envFlagScope)
  }

  const envName = readProcessEnvName(node)
  if (envName) return [envName]

  if (ts.isIdentifier(node)) {
    return envFlagScope.get(node.text) ?? null
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return mergeEnvFlags(
      collectEnablingEnvFlags(node.left, envFlagScope),
      collectEnablingEnvFlags(node.right, envFlagScope),
    )
  }

  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'parseBooleanWithDefault'
    && node.arguments[0]
  ) {
    const envArgument = readProcessEnvName(node.arguments[0])
    return envArgument ? [envArgument] : null
  }

  return null
}

type BranchContext = {
  active: boolean
  envFlags: string[] | null
}

function collectPushEntriesFromStatement(
  statement: ts.Statement,
  env: NodeJS.ProcessEnv,
  targetVariableName: string,
  scope: Map<string, unknown>,
  envFlagScope: EnvFlagScope,
  branch: BranchContext = { active: true, envFlags: [] },
): ModuleOccurrence[] {
  if (ts.isBlock(statement)) {
    return statement.statements.flatMap((child) =>
      collectPushEntriesFromStatement(child, env, targetVariableName, scope, envFlagScope, branch),
    )
  }

  if (ts.isIfStatement(statement)) {
    const conditionMet = evaluateStaticCondition(statement.expression, env, scope)
    const envFlags = mergeEnvFlags(branch.envFlags, collectEnablingEnvFlags(statement.expression, envFlagScope))
    const thenEntries = collectPushEntriesFromStatement(
      statement.thenStatement,
      env,
      targetVariableName,
      scope,
      envFlagScope,
      { active: branch.active && conditionMet, envFlags },
    )
    const elseEntries = statement.elseStatement
      ? collectPushEntriesFromStatement(
          statement.elseStatement,
          env,
          targetVariableName,
          scope,
          envFlagScope,
          { active: branch.active && !conditionMet, envFlags: null },
        )
      : []
    return [...thenEntries, ...elseEntries]
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
    return entry ? [{ entry, node: argument, active: branch.active, envFlags: branch.envFlags }] : []
  })
}

function activeEntries(occurrences: ModuleOccurrence[]): ModuleEntry[] {
  return occurrences.filter((occurrence) => occurrence.active).map((occurrence) => occurrence.entry)
}

function parseModuleConfigShape(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): ModuleConfigShape {
  const sourceFile = ts.createSourceFile('modules.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const variableName = 'enabledModules'
  const occurrences: ModuleOccurrence[] = []
  const scope = new Map<string, unknown>()
  const envFlagScope: EnvFlagScope = new Map()
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
            return entry ? [{ entry, node: element, active: true, envFlags: [] }] : []
          }))
          scope.set(variableName, activeEntries(occurrences))
          foundDeclaration = true
          continue
        }

        if (!declaration.initializer) continue

        scope.set(
          declaration.name.text,
          evaluateStaticExpressionWithScope(declaration.initializer, env, scope),
        )
        envFlagScope.set(declaration.name.text, collectEnablingEnvFlags(declaration.initializer, envFlagScope))
      }
      continue
    }

    if (!foundDeclaration) continue

    const pushedOccurrences = collectPushEntriesFromStatement(statement, env, variableName, scope, envFlagScope)
    if (pushedOccurrences.length > 0) {
      occurrences.push(...pushedOccurrences)
      scope.set(variableName, activeEntries(occurrences))
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

function nextTokenEnd(source: string, position: number): number {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  scanner.resetTokenState(position)
  scanner.scan()
  return scanner.getTokenEnd()
}

function trailingCommentsEnd(source: string, position: number): number {
  const ranges = ts.getTrailingCommentRanges(source, position) ?? []
  return ranges.length > 0 ? ranges[ranges.length - 1].end : position
}

function insertArrayElement(
  source: string,
  arrayNode: ts.ArrayLiteralExpression,
  entry: ModuleEntry,
  sourceFile: ts.SourceFile,
): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const entryLiteral = buildModuleEntryLiteral(entry)
  const openingBracket = arrayNode.getStart(sourceFile)
  const closingBracket = arrayNode.end - 1
  const openingIndent = lineIndentAt(source, openingBracket)
  const lastElement = arrayNode.elements[arrayNode.elements.length - 1]

  let head: string
  let insertAt: number
  let insertion: string

  if (!lastElement) {
    const innerContent = source.slice(openingBracket + 1, closingBracket).trimEnd()
    insertAt = openingBracket + 1 + innerContent.length
    head = source.slice(0, insertAt)
    insertion = `${newline}${openingIndent}  ${entryLiteral},`
  } else {
    const hasTrailingComma = arrayNode.elements.hasTrailingComma
    const anchor = hasTrailingComma ? nextTokenEnd(source, lastElement.end) : lastElement.end
    insertAt = trailingCommentsEnd(source, anchor)
    head = hasTrailingComma
      ? source.slice(0, insertAt)
      : `${source.slice(0, anchor)},${source.slice(anchor, insertAt)}`
    const lastElementStart = lastElement.getStart(sourceFile)
    const startsOnOpeningLine = !source.slice(openingBracket, lastElementStart).includes('\n')
    const elementIndent = startsOnOpeningLine
      ? `${openingIndent}  `
      : lineIndentAt(source, lastElementStart)
    insertion = `${newline}${elementIndent}${entryLiteral}${hasTrailingComma ? ',' : ''}`
  }

  const closesOnSameLine = !source.slice(insertAt, closingBracket).includes('\n')
  const closingLine = closesOnSameLine ? `${newline}${openingIndent}` : ''
  const tail = closesOnSameLine ? source.slice(closingBracket) : source.slice(insertAt)

  return head + insertion + closingLine + tail
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

export function readEnabledModules(modulesPath: string, env: NodeJS.ProcessEnv = process.env): ModuleEntry[] {
  const source = fs.readFileSync(modulesPath, 'utf8')
  // keeps only registrations whose condition holds; #8116 tags the others `active: false` instead of skipping them
  return parseModuleConfigShape(source, env)
    .occurrences.filter((occurrence) => !('active' in occurrence) || occurrence.active !== false)
    .map((occurrence) => normalizeModuleEntry(occurrence.entry))
}

export class ModuleGatedOffError extends Error {
  readonly code = 'MODULE_GATED_OFF'

  constructor(
    message: string,
    readonly moduleId: string,
    readonly envFlags: string[],
  ) {
    super(message)
    this.name = 'ModuleGatedOffError'
  }
}

function resolveFlagsToSet(occurrences: ModuleOccurrence[], env: NodeJS.ProcessEnv): string[] {
  if (occurrences.some((occurrence) => occurrence.envFlags === null)) return []
  const envFlags = Array.from(new Set(occurrences.flatMap((occurrence) => occurrence.envFlags ?? [])))
  return envFlags.filter((flag) => !parseBooleanWithDefault(env[flag], false))
}

function buildModuleGatedOffError(
  moduleId: string,
  modulesPath: string,
  occurrences: ModuleOccurrence[],
  env: NodeJS.ProcessEnv = process.env,
): ModuleGatedOffError {
  const flagsToSet = resolveFlagsToSet(occurrences, env)
  const prefix = `Module "${moduleId}" is already registered in ${modulesPath} behind a condition that is currently off, so no second entry was added.`
  const message = flagsToSet.length === 0
    ? `${prefix} Make that condition true to enable it.`
    : `${prefix} Enable it by setting ${flagsToSet.map((flag) => `${flag}=true`).join(' and ')} in your environment (.env), then run \`yarn generate\`.`
  return new ModuleGatedOffError(message, moduleId, flagsToSet)
}

export function assertModuleNotGatedOff(modulesPath: string, moduleId: string): void {
  if (!fs.existsSync(modulesPath)) return

  const config = parseModuleConfigShape(fs.readFileSync(modulesPath, 'utf8'))
  const matches = config.occurrences.filter((occurrence) => occurrence.entry.id === moduleId)
  if (matches.length > 0 && matches.every((occurrence) => !occurrence.active)) {
    throw buildModuleGatedOffError(moduleId, modulesPath, matches)
  }
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
  const allMatches = config.occurrences.filter((occurrence) => occurrence.entry.id === normalized.id)
  const matches = allMatches.filter((occurrence) => occurrence.active)

  if (matches.length === 0 && allMatches.length > 0) {
    throw buildModuleGatedOffError(normalized.id, modulesPath, allMatches)
  }

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

  const updated = insertArrayElement(source, config.arrayNode, normalized, sourceFile)
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
  const matches = config.occurrences.filter((occurrence) => occurrence.active && occurrence.entry.id === moduleId)

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
