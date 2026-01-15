import * as ts from 'typescript'
import { readFileSync } from 'fs'
import { z } from 'zod'

/**
 * Parsed parameter from CLI command AST analysis.
 */
export interface ParsedParameter {
  name: string
  aliases: string[]
  required: boolean
  type: 'string' | 'boolean'
}

/**
 * Parsed CLI command from AST analysis.
 */
export interface ParsedCommand {
  name: string
  parameters: ParsedParameter[]
  usageString?: string
}

/**
 * Parse CLI file using TypeScript AST to extract command metadata.
 * This function analyzes the source code structure to discover:
 * - Command names from { command: '...' } objects
 * - Parameters from args.xxx property access patterns
 * - Aliases from args.a ?? args.b nullish coalescing patterns
 * - Usage strings from console.error('Usage: ...') calls
 */
export function parseCliFileAst(filePath: string): ParsedCommand[] {
  const sourceCode = readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  )

  return extractCommands(sourceFile)
}

/**
 * Parse CLI source code directly (for testing without file I/O).
 */
export function parseCliSourceAst(sourceCode: string, fileName = 'test.ts'): ParsedCommand[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  )

  return extractCommands(sourceFile)
}

/**
 * Build a Zod schema from parsed parameters.
 */
export function buildSchemaFromParams(params: ParsedParameter[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}

  // Context params that are auto-injected, skip them
  const contextParams = ['tenantId', 'tenant', 'organizationId', 'orgId', 'org']

  for (const param of params) {
    if (contextParams.includes(param.name)) {
      continue
    }

    let schema: z.ZodTypeAny = param.type === 'boolean' ? z.boolean() : z.string()

    if (!param.required) {
      schema = schema.optional()
    }

    if (param.aliases.length > 0) {
      schema = schema.describe(`Aliases: ${param.aliases.join(', ')}`)
    }

    shape[param.name] = schema
  }

  return z.object(shape)
}

/**
 * Extract module ID from file path.
 */
export function extractModuleId(filePath: string): string {
  const match = filePath.match(/modules\/([^/]+)\/cli/)
  return match?.[1] || 'unknown'
}

// --- Internal AST traversal functions ---

function extractCommands(sourceFile: ts.SourceFile): ParsedCommand[] {
  const commands: ParsedCommand[] = []

  function visit(node: ts.Node) {
    // Look for objects with shape: { command: '...', run: ... }
    if (ts.isObjectLiteralExpression(node)) {
      const commandProp = node.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'command'
      ) as ts.PropertyAssignment | undefined

      const runProp = node.properties.find(
        (p) =>
          (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) &&
          ts.isIdentifier(p.name) &&
          p.name.text === 'run'
      ) as ts.PropertyAssignment | ts.MethodDeclaration | undefined

      if (commandProp && runProp && ts.isStringLiteral(commandProp.initializer)) {
        const name = commandProp.initializer.text
        const runBody = ts.isMethodDeclaration(runProp)
          ? runProp.body
          : ts.isPropertyAssignment(runProp)
            ? runProp.initializer
            : undefined

        if (runBody) {
          const parameters = extractParameters(runBody)
          const usageString = extractUsageString(runBody)
          commands.push({ name, parameters, usageString })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return commands
}

function extractParameters(runFunction: ts.Node): ParsedParameter[] {
  const params = new Map<string, ParsedParameter>()
  const requiredParams = new Set<string>()

  function visit(node: ts.Node) {
    // Pattern: args.xxx (property access)
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'args'
    ) {
      const name = node.name.text
      if (!params.has(name)) {
        params.set(name, { name, aliases: [], required: false, type: 'string' })
      }
    }

    // Pattern: args['xxx'] (element access)
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'args' &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      const name = node.argumentExpression.text
      if (!params.has(name)) {
        params.set(name, { name, aliases: [], required: false, type: 'string' })
      }
    }

    // Pattern: args.a ?? args.b (nullish coalescing for aliases)
    // Only process the outermost nullish coalescing to avoid overwrites from nested expressions
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      !isNestedNullishCoalescing(node)
    ) {
      const aliases = extractAliasChain(node)
      if (aliases.length > 1) {
        // The first one becomes the primary, rest are aliases
        const primary = aliases[0]
        if (!params.has(primary)) {
          params.set(primary, { name: primary, aliases: [], required: false, type: 'string' })
        }
        params.get(primary)!.aliases = aliases.slice(1)
        // Remove other aliases from params since they're now captured in aliases array
        for (const alias of aliases.slice(1)) {
          if (params.has(alias) && alias !== primary) {
            params.delete(alias)
          }
        }
      }
    }

    // Pattern: if (!param) { console.error('Usage:...'); return } → required param
    if (ts.isIfStatement(node)) {
      const required = extractRequiredFromIfStatement(node)
      required.forEach((name) => requiredParams.add(name))
    }

    ts.forEachChild(node, visit)
  }

  // Handle both function bodies and direct expressions
  if (ts.isFunctionExpression(runFunction) || ts.isArrowFunction(runFunction)) {
    if (runFunction.body) {
      visit(runFunction.body)
    }
  } else if (ts.isBlock(runFunction)) {
    visit(runFunction)
  } else {
    visit(runFunction)
  }

  // Mark required params
  for (const [name, param] of params) {
    if (requiredParams.has(name)) {
      param.required = true
    }
  }

  return Array.from(params.values())
}

/**
 * Check if a binary expression is nested inside another nullish coalescing expression.
 * This helps us only process the outermost chain.
 */
function isNestedNullishCoalescing(node: ts.BinaryExpression): boolean {
  const parent = node.parent
  if (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    return true
  }
  return false
}

function extractAliasChain(node: ts.BinaryExpression): string[] {
  const aliases: string[] = []

  function extract(n: ts.Expression) {
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      extract(n.left)
      extract(n.right)
    } else if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'args'
    ) {
      aliases.push(n.name.text)
    }
  }

  extract(node)
  return aliases
}

function extractRequiredFromIfStatement(node: ts.IfStatement): string[] {
  const required: string[] = []
  const condition = node.expression

  // Pattern: if (!email || !password) or if (!email)
  function extractFromCondition(expr: ts.Expression) {
    // !param
    if (
      ts.isPrefixUnaryExpression(expr) &&
      expr.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isIdentifier(expr.operand)
    ) {
      required.push(expr.operand.text)
    }
    // a || b
    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      extractFromCondition(expr.left)
      extractFromCondition(expr.right)
    }
  }

  // Only consider if statements that have console.error with 'Usage' in body
  let hasUsageError = false
  function checkForUsageError(n: ts.Node) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'error'
    ) {
      const arg = n.arguments[0]
      if (arg && ts.isStringLiteral(arg) && arg.text.includes('Usage')) {
        hasUsageError = true
      }
    }
    ts.forEachChild(n, checkForUsageError)
  }

  checkForUsageError(node.thenStatement)

  if (hasUsageError) {
    extractFromCondition(condition)
  }

  return required
}

function extractUsageString(runFunction: ts.Node): string | undefined {
  let usage: string | undefined

  function visit(node: ts.Node) {
    // Look for: console.error('Usage: ...')
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'error'
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg) && arg.text.startsWith('Usage:')) {
        usage = arg.text
      }
    }
    ts.forEachChild(node, visit)
  }

  if (ts.isFunctionExpression(runFunction) || ts.isArrowFunction(runFunction)) {
    if (runFunction.body) {
      visit(runFunction.body)
    }
  } else if (ts.isBlock(runFunction)) {
    visit(runFunction)
  }

  return usage
}
