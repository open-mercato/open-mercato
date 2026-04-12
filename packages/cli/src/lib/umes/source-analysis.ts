import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const MODULE_CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const
const UNKNOWN_STATIC_VALUE = Symbol('umes-static-unknown')

type ImportBinding = {
  exportName: string
  filePath: string
}

type ExportBinding =
  | { kind: 'identifier'; name: string }
  | { kind: 'expression'; expression: ts.Expression }

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration

type FunctionRef = {
  filePath: string
  kind: 'function-ref'
  node: FunctionNode
}

type ParsedSourceModule = {
  defaultExport?: ExportBinding
  exports: Map<string, ExportBinding>
  functions: Map<string, FunctionNode>
  imports: Map<string, ImportBinding>
  variables: Map<string, ts.Expression>
}

type EvaluationState = {
  evaluating: Set<string>
  modules: Map<string, ParsedSourceModule | null>
  values: Map<string, unknown>
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function isRelativeModuleSpecifier(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../')
}

function resolveRelativeImportPath(fromFilePath: string, specifier: string): string | null {
  const basePath = path.resolve(path.dirname(fromFilePath), specifier)
  const candidates = new Set<string>()

  if (path.extname(basePath)) {
    candidates.add(basePath)
  } else {
    candidates.add(basePath)
    for (const extension of MODULE_CODE_EXTENSIONS) {
      candidates.add(`${basePath}${extension}`)
      candidates.add(path.join(basePath, `index${extension}`))
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }

  return null
}

function isFunctionNode(value: unknown): value is FunctionNode {
  return Boolean(value)
    && (
      ts.isArrowFunction(value as ts.Node)
      || ts.isFunctionDeclaration(value as ts.Node)
      || ts.isFunctionExpression(value as ts.Node)
      || ts.isGetAccessorDeclaration(value as ts.Node)
      || ts.isMethodDeclaration(value as ts.Node)
      || ts.isSetAccessorDeclaration(value as ts.Node)
    )
}

function createFunctionRef(filePath: string, node: FunctionNode): FunctionRef {
  return {
    filePath,
    kind: 'function-ref',
    node,
  }
}

function isFunctionRef(value: unknown): value is FunctionRef {
  return Boolean(value)
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'function-ref'
}

function isUnknownStaticValue(value: unknown): boolean {
  return value === UNKNOWN_STATIC_VALUE
}

function toBoolean(value: unknown): boolean {
  if (isUnknownStaticValue(value)) return false
  return Boolean(value)
}

function readPropertyKey(
  name: ts.PropertyName,
  evaluateExpression: (expression: ts.Expression) => unknown,
): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name)) {
    const resolved = evaluateExpression(name.expression)
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      return String(resolved)
    }
  }
  return null
}

function createParsedSourceModule(filePath: string): ParsedSourceModule | null {
  let source = ''
  try {
    source = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  const parsed = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    inferScriptKind(filePath),
  )

  const imports = new Map<string, ImportBinding>()
  const variables = new Map<string, ts.Expression>()
  const functions = new Map<string, FunctionNode>()
  const exports = new Map<string, ExportBinding>()
  let defaultExport: ExportBinding | undefined

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null
      if (!moduleSpecifier || !isRelativeModuleSpecifier(moduleSpecifier)) continue
      const resolvedImportPath = resolveRelativeImportPath(filePath, moduleSpecifier)
      if (!resolvedImportPath) continue
      const clause = statement.importClause
      if (!clause) continue
      if (clause.name) {
        imports.set(clause.name.text, { filePath: resolvedImportPath, exportName: 'default' })
      }
      if (
        clause.namedBindings
        && ts.isNamedImports(clause.namedBindings)
      ) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, {
            filePath: resolvedImportPath,
            exportName: element.propertyName?.text ?? element.name.text,
          })
        }
      }
      continue
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement)
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
      if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.set(statement.name.text, { kind: 'identifier', name: statement.name.text })
      }
      continue
    }

    if (ts.isVariableStatement(statement)) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
      const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false

      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const declarationName = declaration.name.text
        if (isFunctionNode(declaration.initializer)) {
          functions.set(declarationName, declaration.initializer)
        } else {
          variables.set(declarationName, declaration.initializer)
        }
        if (isExported) {
          exports.set(declarationName, { kind: 'identifier', name: declarationName })
        }
      }
      continue
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = { kind: 'expression', expression: statement.expression }
      continue
    }

    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && !statement.moduleSpecifier
    ) {
      for (const element of statement.exportClause.elements) {
        const exportName = element.name.text
        const localName = element.propertyName?.text ?? element.name.text
        if (exportName === 'default') {
          defaultExport = { kind: 'identifier', name: localName }
        } else {
          exports.set(exportName, { kind: 'identifier', name: localName })
        }
      }
    }
  }

  return {
    defaultExport,
    exports,
    functions,
    imports,
    variables,
  }
}

function createEvaluationState(): EvaluationState {
  return {
    evaluating: new Set<string>(),
    modules: new Map<string, ParsedSourceModule>(),
    values: new Map<string, unknown>(),
  }
}

function readReturnExpression(node: FunctionNode): ts.Expression | undefined {
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
    return node.body
  }
  const body = node.body
  if (!body || !ts.isBlock(body)) return undefined
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression
    }
  }
  return undefined
}

export function createStaticModuleReader() {
  const state = createEvaluationState()

  function getParsedModule(filePath: string): ParsedSourceModule | null {
    if (state.modules.has(filePath)) {
      return state.modules.get(filePath) ?? null
    }
    const parsed = createParsedSourceModule(filePath)
    if (!parsed) {
      state.modules.set(filePath, null)
      return null
    }
    state.modules.set(filePath, parsed)
    return parsed
  }

  function evaluateNamedExport(filePath: string, exportName: string): unknown {
    const cacheKey = `export:${filePath}:${exportName}`
    if (state.values.has(cacheKey)) {
      return state.values.get(cacheKey)
    }
    if (state.evaluating.has(cacheKey)) {
      return UNKNOWN_STATIC_VALUE
    }

    state.evaluating.add(cacheKey)
    try {
      const parsed = getParsedModule(filePath)
      if (!parsed) {
        state.values.set(cacheKey, undefined)
        return undefined
      }

      const binding = exportName === 'default' ? parsed.defaultExport : parsed.exports.get(exportName)
      if (!binding) {
        state.values.set(cacheKey, undefined)
        return undefined
      }

      const evaluated = binding.kind === 'identifier'
        ? evaluateIdentifier(filePath, binding.name, new Map())
        : evaluateExpression(filePath, binding.expression, new Map())
      state.values.set(cacheKey, evaluated)
      return evaluated
    } finally {
      state.evaluating.delete(cacheKey)
    }
  }

  function evaluateIdentifier(
    filePath: string,
    name: string,
    locals: Map<string, unknown>,
  ): unknown {
    if (locals.has(name)) {
      return locals.get(name)
    }

    const cacheKey = `identifier:${filePath}:${name}`
    if (state.values.has(cacheKey)) {
      return state.values.get(cacheKey)
    }
    if (state.evaluating.has(cacheKey)) {
      return UNKNOWN_STATIC_VALUE
    }

    state.evaluating.add(cacheKey)
    try {
      const parsed = getParsedModule(filePath)
      if (!parsed) {
        state.values.set(cacheKey, undefined)
        return undefined
      }

      if (parsed.functions.has(name)) {
        const functionRef = createFunctionRef(filePath, parsed.functions.get(name)!)
        state.values.set(cacheKey, functionRef)
        return functionRef
      }

      if (parsed.variables.has(name)) {
        const value = evaluateExpression(filePath, parsed.variables.get(name)!, new Map())
        state.values.set(cacheKey, value)
        return value
      }

      const importBinding = parsed.imports.get(name)
      if (importBinding) {
        const value = evaluateNamedExport(importBinding.filePath, importBinding.exportName)
        state.values.set(cacheKey, value)
        return value
      }

      state.values.set(cacheKey, UNKNOWN_STATIC_VALUE)
      return UNKNOWN_STATIC_VALUE
    } finally {
      state.evaluating.delete(cacheKey)
    }
  }

  function callFunctionRef(
    functionRef: FunctionRef,
    args: readonly ts.Expression[],
    parentLocals: Map<string, unknown>,
  ): unknown {
    const locals = new Map(parentLocals)
    for (let index = 0; index < functionRef.node.parameters.length; index += 1) {
      const parameter = functionRef.node.parameters[index]
      if (!ts.isIdentifier(parameter.name)) continue
      const argExpression = args[index]
      const argValue = argExpression
        ? evaluateExpression(functionRef.filePath, argExpression, parentLocals)
        : parameter.initializer
          ? evaluateExpression(functionRef.filePath, parameter.initializer, parentLocals)
          : undefined
      locals.set(parameter.name.text, argValue)
    }

    const returnExpression = readReturnExpression(functionRef.node)
    if (!returnExpression) return UNKNOWN_STATIC_VALUE
    return evaluateExpression(functionRef.filePath, returnExpression, locals)
  }

  function evaluateExpression(
    filePath: string,
    expression: ts.Expression,
    locals: Map<string, unknown>,
  ): unknown {
    if (ts.isParenthesizedExpression(expression)) {
      return evaluateExpression(filePath, expression.expression, locals)
    }
    if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
      return evaluateExpression(filePath, expression.expression, locals)
    }
    if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text
    }
    if (ts.isNumericLiteral(expression)) {
      return Number(expression.text)
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
    if (expression.kind === ts.SyntaxKind.NullKeyword) return null

    if (ts.isIdentifier(expression)) {
      return evaluateIdentifier(filePath, expression.text, locals)
    }

    if (ts.isArrayLiteralExpression(expression)) {
      const values: unknown[] = []
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          const spreadValue = evaluateExpression(filePath, element.expression, locals)
          if (Array.isArray(spreadValue)) {
            values.push(...spreadValue)
          }
          continue
        }
        values.push(evaluateExpression(filePath, element, locals))
      }
      return values
    }

    if (ts.isObjectLiteralExpression(expression)) {
      const result: Record<string, unknown> = {}
      for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spreadValue = evaluateExpression(filePath, property.expression, locals)
          if (spreadValue && typeof spreadValue === 'object' && !Array.isArray(spreadValue)) {
            Object.assign(result, spreadValue)
          }
          continue
        }

        if (
          ts.isMethodDeclaration(property)
          || ts.isGetAccessorDeclaration(property)
          || ts.isSetAccessorDeclaration(property)
        ) {
          const key = readPropertyKey(property.name, (node) => evaluateExpression(filePath, node, locals))
          if (key) {
            result[key] = createFunctionRef(filePath, property)
          }
          continue
        }

        if (ts.isShorthandPropertyAssignment(property)) {
          result[property.name.text] = evaluateIdentifier(filePath, property.name.text, locals)
          continue
        }

        if (!ts.isPropertyAssignment(property)) continue
        const key = readPropertyKey(property.name, (node) => evaluateExpression(filePath, node, locals))
        if (!key) continue
        result[key] = evaluateExpression(filePath, property.initializer, locals)
      }
      return result
    }

    if (ts.isConditionalExpression(expression)) {
      return toBoolean(evaluateExpression(filePath, expression.condition, locals))
        ? evaluateExpression(filePath, expression.whenTrue, locals)
        : evaluateExpression(filePath, expression.whenFalse, locals)
    }

    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
      return !toBoolean(evaluateExpression(filePath, expression.operand, locals))
    }

    if (ts.isBinaryExpression(expression)) {
      const left = evaluateExpression(filePath, expression.left, locals)
      switch (expression.operatorToken.kind) {
        case ts.SyntaxKind.BarBarToken:
          return toBoolean(left) ? left : evaluateExpression(filePath, expression.right, locals)
        case ts.SyntaxKind.AmpersandAmpersandToken:
          return toBoolean(left) ? evaluateExpression(filePath, expression.right, locals) : left
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return left === evaluateExpression(filePath, expression.right, locals)
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return left !== evaluateExpression(filePath, expression.right, locals)
        case ts.SyntaxKind.PlusToken: {
          const right = evaluateExpression(filePath, expression.right, locals)
          if (
            (typeof left === 'string' || typeof left === 'number')
            && (typeof right === 'string' || typeof right === 'number')
          ) {
            return typeof left === 'number' && typeof right === 'number'
              ? left + right
              : `${left}${right}`
          }
          return UNKNOWN_STATIC_VALUE
        }
        default:
          return UNKNOWN_STATIC_VALUE
      }
    }

    if (ts.isTemplateExpression(expression)) {
      let output = expression.head.text
      for (const span of expression.templateSpans) {
        const value = evaluateExpression(filePath, span.expression, locals)
        output += isUnknownStaticValue(value) || value == null ? '' : String(value)
        output += span.literal.text
      }
      return output
    }

    if (
      ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === 'process'
      && expression.name.text === 'env'
    ) {
      return process.env
    }

    if (ts.isPropertyAccessExpression(expression)) {
      if (
        ts.isPropertyAccessExpression(expression.expression)
        && ts.isIdentifier(expression.expression.expression)
        && expression.expression.expression.text === 'process'
        && expression.expression.name.text === 'env'
      ) {
        return process.env[expression.name.text]
      }
      const target = evaluateExpression(filePath, expression.expression, locals)
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        return (target as Record<string, unknown>)[expression.name.text] ?? UNKNOWN_STATIC_VALUE
      }
      return UNKNOWN_STATIC_VALUE
    }

    if (ts.isElementAccessExpression(expression)) {
      if (
        ts.isPropertyAccessExpression(expression.expression)
        && ts.isIdentifier(expression.expression.expression)
        && expression.expression.expression.text === 'process'
        && expression.expression.name.text === 'env'
        && ts.isStringLiteralLike(expression.argumentExpression)
      ) {
        return process.env[expression.argumentExpression.text]
      }
      const target = evaluateExpression(filePath, expression.expression, locals)
      const key = evaluateExpression(filePath, expression.argumentExpression, locals)
      if (
        target
        && typeof target === 'object'
        && !Array.isArray(target)
        && (typeof key === 'string' || typeof key === 'number')
      ) {
        return (target as Record<string, unknown>)[String(key)] ?? UNKNOWN_STATIC_VALUE
      }
      return UNKNOWN_STATIC_VALUE
    }

    if (ts.isCallExpression(expression)) {
      if (ts.isIdentifier(expression.expression)) {
        if (expression.expression.text === 'parseBooleanWithDefault') {
          const rawValue = expression.arguments[0]
            ? evaluateExpression(filePath, expression.arguments[0], locals)
            : undefined
          const fallbackValue = expression.arguments[1]
            ? evaluateExpression(filePath, expression.arguments[1], locals)
            : false
          return parseBooleanWithDefault(
            typeof rawValue === 'string' ? rawValue : undefined,
            Boolean(fallbackValue),
          )
        }

        if (expression.expression.text === 'buildIntegrationDetailWidgetSpotId') {
          const integrationId = expression.arguments[0]
            ? evaluateExpression(filePath, expression.arguments[0], locals)
            : undefined
          return typeof integrationId === 'string'
            ? `integrations.detail:${integrationId}`
            : UNKNOWN_STATIC_VALUE
        }
      }

      if (
        ts.isPropertyAccessExpression(expression.expression)
        && ts.isIdentifier(expression.expression.expression)
        && expression.expression.expression.text === 'ComponentReplacementHandles'
      ) {
        const args = expression.arguments.map((arg) => evaluateExpression(filePath, arg, locals))
        switch (expression.expression.name.text) {
          case 'page':
            return typeof args[0] === 'string' ? `page:${args[0]}` : UNKNOWN_STATIC_VALUE
          case 'dataTable':
            return typeof args[0] === 'string' ? `data-table:${args[0]}` : UNKNOWN_STATIC_VALUE
          case 'crudForm':
            return typeof args[0] === 'string' ? `crud-form:${args[0]}` : UNKNOWN_STATIC_VALUE
          case 'section':
            return typeof args[0] === 'string' && typeof args[1] === 'string'
              ? `section:${args[0]}.${args[1]}`
              : UNKNOWN_STATIC_VALUE
          default:
            return UNKNOWN_STATIC_VALUE
        }
      }

      const callee = evaluateExpression(filePath, expression.expression, locals)
      if (isFunctionRef(callee)) {
        return callFunctionRef(callee, expression.arguments, locals)
      }
      return UNKNOWN_STATIC_VALUE
    }

    return UNKNOWN_STATIC_VALUE
  }

  function readExport(filePath: string, exportNames: string[]): unknown {
    for (const exportName of exportNames) {
      const value = evaluateNamedExport(filePath, exportName)
      if (value !== undefined && !isUnknownStaticValue(value)) {
        return value
      }
    }
    return undefined
  }

  return {
    readExport,
  }
}
