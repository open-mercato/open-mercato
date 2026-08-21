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

function isEntityDecorator(decorator: ts.Decorator): boolean {
  const expression = decorator.expression
  if (ts.isCallExpression(expression)) {
    return ts.isIdentifier(expression.expression) && expression.expression.text === 'Entity'
  }
  return ts.isIdentifier(expression) && expression.text === 'Entity'
}

function hasEntityDecorator(node: ts.ClassDeclaration): boolean {
  if (!ts.canHaveDecorators(node)) return false
  return (ts.getDecorators(node) ?? []).some(isEntityDecorator)
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
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const localExports = collectLocalExportNames(sourceFile)
  const classNames: string[] = []
  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return
    if (!hasEntityDecorator(node)) return
    const className = node.name.text
    if (!isExported(node) && !localExports.has(className)) return
    if (!classNames.includes(className)) classNames.push(className)
  })
  return classNames
}
