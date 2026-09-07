import fs from 'node:fs'
import ts from 'typescript-js'

/**
 * Names of the `@Entity()`-decorated classes a module's entity file exports.
 *
 * Only decorated classes count: an entity file may also export plain helper classes,
 * and reporting those as entities would raise false collisions. Only a decorator bound
 * to a `@mikro-orm/*` import counts, so an unrelated `Entity` decorator from another
 * library never registers as one.
 *
 * Parsing is used rather than importing because the caller runs during generation,
 * before the module graph exists. A monorepo checkout and a standalone install that
 * ships `src/modules` both hand this TypeScript source; a package that ships compiled
 * output only hands it the built file instead, where a decorated class has become a
 * class expression plus a decorator-helper call, so both shapes are recognised.
 */

const MIKRO_ORM_MODULE_PREFIX = '@mikro-orm/'

type EntityDecoratorBindings = {
  /** Local names bound to MikroORM's `Entity` export, including aliased imports. */
  named: Set<string>
  /** Local names bound to a whole MikroORM module, for `@orm.Entity()`. */
  namespaces: Set<string>
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js') || filePath.endsWith('.cjs') || filePath.endsWith('.mjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function isMikroOrmModule(specifier: string): boolean {
  return specifier.startsWith(MIKRO_ORM_MODULE_PREFIX)
}

/** `require('@mikro-orm/core')` as it survives into compiled CommonJS output. */
function readRequiredModuleSpecifier(expression: ts.Expression | undefined): string | undefined {
  if (!expression || !ts.isCallExpression(expression)) return undefined
  if (!ts.isIdentifier(expression.expression) || expression.expression.text !== 'require') return undefined
  const [argument] = expression.arguments
  return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined
}

function collectEntityDecoratorBindings(sourceFile: ts.SourceFile): EntityDecoratorBindings {
  const named = new Set<string>()
  const namespaces = new Set<string>()

  const addFromNamedBindings = (bindings: ts.NamedImportBindings | undefined): void => {
    if (!bindings) return
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text)
      return
    }
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'Entity') named.add(element.name.text)
    }
  }

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteralLike(node.moduleSpecifier) || !isMikroOrmModule(node.moduleSpecifier.text)) return
      addFromNamedBindings(node.importClause?.namedBindings)
      return
    }
    if (!ts.isVariableStatement(node)) return
    for (const declaration of node.declarationList.declarations) {
      const specifier = readRequiredModuleSpecifier(declaration.initializer)
      if (!specifier || !isMikroOrmModule(specifier)) continue
      if (ts.isIdentifier(declaration.name)) {
        namespaces.add(declaration.name.text)
        continue
      }
      if (!ts.isObjectBindingPattern(declaration.name)) continue
      for (const element of declaration.name.elements) {
        const sourceName = element.propertyName ?? element.name
        if (ts.isIdentifier(sourceName) && sourceName.text === 'Entity' && ts.isIdentifier(element.name)) {
          named.add(element.name.text)
        }
      }
    }
  })

  return { named, namespaces }
}

/** Unwraps the `(0, core_1.Entity)` form a CommonJS emit produces. */
function unwrapReference(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrapReference(expression.expression)
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return unwrapReference(expression.right)
  }
  return expression
}

/** Accepts `Entity`, an aliased local name, and `<mikroOrmNamespace>.Entity`. */
function isEntityReference(expression: ts.Expression, bindings: EntityDecoratorBindings): boolean {
  const reference = unwrapReference(expression)
  if (ts.isIdentifier(reference)) return bindings.named.has(reference.text)
  if (!ts.isPropertyAccessExpression(reference)) return false
  if (reference.name.text !== 'Entity') return false
  return ts.isIdentifier(reference.expression) && bindings.namespaces.has(reference.expression.text)
}

/** Accepts `@Entity`, `@Entity(...)` and the aliased or namespace-qualified forms. */
function isEntityDecorator(decorator: ts.Decorator, bindings: EntityDecoratorBindings): boolean {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression
  return isEntityReference(expression, bindings)
}

function hasEntityDecorator(node: ts.ClassDeclaration, bindings: EntityDecoratorBindings): boolean {
  if (!ts.canHaveDecorators(node)) return false
  return (ts.getDecorators(node) ?? []).some((decorator) => isEntityDecorator(decorator, bindings))
}

function isExportedDeclaration(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    : false
}

/**
 * Names the file exports without redeclaring them: `export { X }`, the CommonJS
 * `exports.X = X`, and the `__export(exports, { X: () => X })` table a bundler emits.
 */
function collectIndirectExportNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()

  const addExportTable = (expression: ts.Expression): void => {
    if (!ts.isObjectLiteralExpression(expression)) return
    for (const property of expression.properties) {
      if (!property.name) continue
      const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        ? property.name.text
        : undefined
      if (name) names.add(name)
    }
  }

  sourceFile.forEachChild((node) => {
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier) {
      const clause = node.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) names.add((element.propertyName ?? element.name).text)
      }
      return
    }
    if (!ts.isExpressionStatement(node)) return
    const expression = node.expression
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression
      // esbuild emits `__export(ns, {...})`, SWC `_export(exports, {...})`.
      if (ts.isIdentifier(callee) && /^_*export$/.test(callee.text) && expression.arguments.length >= 2) {
        addExportTable(expression.arguments[1])
      }
      return
    }
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
    const target = expression.left
    if (!ts.isPropertyAccessExpression(target)) return
    if (!ts.isIdentifier(target.expression) || target.expression.text !== 'exports') return
    names.add(target.name.text)
  })

  return names
}

/**
 * The compiled shape of a decorated class: the class becomes an expression assigned to a
 * variable, and the decorators move into a helper call — `X = __decorateClass([...], X)`
 * for esbuild, `X = __decorate([...], X)` for tsc, `_ts_decorate` for SWC. The helper's
 * name is not matched, since it varies by toolchain; the shape is: a call whose first
 * argument is an array literal and whose result is assigned back to the class binding.
 */
function collectCompiledDecoratedClassNames(
  sourceFile: ts.SourceFile,
  bindings: EntityDecoratorBindings,
): string[] {
  const names: string[] = []
  sourceFile.forEachChild((node) => {
    if (!ts.isExpressionStatement(node)) return
    const assignment = node.expression
    if (!ts.isBinaryExpression(assignment) || assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
    if (!ts.isIdentifier(assignment.left)) return
    const call = assignment.right
    if (!ts.isCallExpression(call) || call.arguments.length === 0) return
    const [decorators] = call.arguments
    if (!ts.isArrayLiteralExpression(decorators)) return
    const target = call.arguments[call.arguments.length - 1]
    if (!target || !ts.isIdentifier(target) || target.text !== assignment.left.text) return
    const decoratesEntity = decorators.elements.some((element) =>
      isEntityReference(ts.isCallExpression(element) ? element.expression : element, bindings))
    if (decoratesEntity) names.push(assignment.left.text)
  })
  return names
}

/** Class-expression bindings a compiled file declares, so `let X = class {}` is seen. */
function collectVariableClassNames(sourceFile: ts.SourceFile): Map<string, boolean> {
  const declared = new Map<string, boolean>()
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    const exported = isExportedDeclaration(node)
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      if (!ts.isClassExpression(declaration.initializer)) continue
      declared.set(declaration.name.text, exported)
    }
  })
  return declared
}

export function parseEntityClassNames(filePath: string): string[] {
  let source: string
  try {
    source = fs.readFileSync(filePath, 'utf8')
  } catch {
    // A warning path must never break generation.
    return []
  }
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2020,
    true,
    inferScriptKind(filePath),
  )
  const bindings = collectEntityDecoratorBindings(sourceFile)
  const indirectExports = collectIndirectExportNames(sourceFile)
  const classNames: string[] = []
  const add = (className: string): void => {
    if (!classNames.includes(className)) classNames.push(className)
  }

  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return
    if (!hasEntityDecorator(node, bindings)) return
    const className = node.name.text
    if (!isExportedDeclaration(node) && !indirectExports.has(className)) return
    add(className)
  })

  const variableClasses = collectVariableClassNames(sourceFile)
  for (const className of collectCompiledDecoratedClassNames(sourceFile, bindings)) {
    if (!variableClasses.has(className)) continue
    if (!variableClasses.get(className) && !indirectExports.has(className)) continue
    add(className)
  }

  return classNames
}
