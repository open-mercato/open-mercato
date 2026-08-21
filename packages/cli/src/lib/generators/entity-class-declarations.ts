import fs from 'node:fs'
import ts from 'typescript-js'

/**
 * Names of the `@Entity()`-decorated classes a module's entity file exports.
 *
 * Only decorated classes count: an entity file may also export plain helper classes,
 * and reporting those as entities would raise false collisions. Parsing is used rather
 * than importing because the caller runs during generation, before the module graph
 * exists.
 */

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Local names bound to MikroORM's `Entity` decorator, so an aliased import
 * (`import { Entity as OrmEntity }`) is still recognised.
 */
function collectEntityDecoratorNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>(['Entity'])
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return
    const bindings = node.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'Entity') {
        names.add(element.name.text)
      }
    }
  })
  return names
}

/**
 * Accepts `@Entity`, `@Entity(...)`, an aliased local name, and a namespace-qualified
 * form such as `@orm.Entity()`.
 */
function isEntityDecorator(decorator: ts.Decorator, entityNames: ReadonlySet<string>): boolean {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression
  if (ts.isIdentifier(expression)) return entityNames.has(expression.text)
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 'Entity'
  return false
}

function hasEntityDecorator(node: ts.ClassDeclaration, entityNames: ReadonlySet<string>): boolean {
  if (!ts.canHaveDecorators(node)) return false
  return (ts.getDecorators(node) ?? []).some((decorator) => isEntityDecorator(decorator, entityNames))
}

function isExported(node: ts.ClassDeclaration): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

/** Names re-exported from the same file via `export { X }` (no module specifier). */
function collectLocalExportNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  sourceFile.forEachChild((node) => {
    if (!ts.isExportDeclaration(node) || node.moduleSpecifier) return
    const clause = node.exportClause
    if (!clause || !ts.isNamedExports(clause)) return
    for (const element of clause.elements) {
      names.add((element.propertyName ?? element.name).text)
    }
  })
  return names
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
  const entityNames = collectEntityDecoratorNames(sourceFile)
  const localExports = collectLocalExportNames(sourceFile)
  const classNames: string[] = []
  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return
    if (!hasEntityDecorator(node, entityNames)) return
    const className = node.name.text
    if (!isExported(node) && !localExports.has(className)) return
    if (!classNames.includes(className)) classNames.push(className)
  })
  return classNames
}
