import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import { MODULE_CODE_EXTENSIONS, stripModuleCodeExtension } from './scanner'

export function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    expression = expression.expression
  }
  return expression
}

export function exportedDeclaration(source: ts.SourceFile, name: string): ts.Expression | undefined {
  const exportedNames = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || statement.moduleSpecifier || !statement.exportClause) continue
    if (!ts.isNamedExports(statement.exportClause)) continue
    for (const entry of statement.exportClause.elements) {
      if (!entry.isTypeOnly && entry.name.text === name) exportedNames.add((entry.propertyName ?? entry.name).text)
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const direct = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      if ((direct && declaration.name.text === name) || exportedNames.has(declaration.name.text)) return declaration.initializer
    }
  }
  return undefined
}

export function fieldsOf(node: ts.Expression, invalid: (reason: string) => never): Map<string, ts.Expression> {
  const literal = unwrap(node)
  if (!ts.isObjectLiteralExpression(literal)) return invalid('expected an object literal')
  const fields = new Map<string, ts.Expression>()
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      return invalid('expected literal property assignments')
    }
    const name = property.name.text
    if (fields.has(name)) return invalid(`duplicate property "${name}"`)
    fields.set(name, property.initializer)
  }
  return fields
}

export function literalData(node: ts.Expression, invalid: (reason: string) => never): unknown {
  const value = unwrap(node)
  if (ts.isStringLiteralLike(value)) return value.text
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (value.kind === ts.SyntaxKind.NullKeyword) return null
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(value)) return value.elements.map((element) => literalData(element, invalid))
  if (ts.isObjectLiteralExpression(value)) {
    return Object.fromEntries([...fieldsOf(value, invalid)]
      .map(([key, entry]) => [key, literalData(entry, invalid)]))
  }
  return invalid('expected JSON-serializable client facts')
}

export function literalValue(node: ts.Expression | undefined, name: string, invalid: (reason: string) => never): string {
  if (!node) return invalid(`missing literal ${name}`)
  const literal = unwrap(node)
  if (!ts.isStringLiteralLike(literal) || !literal.text) return invalid(`expected a non-empty literal ${name}`)
  return literal.text
}

export function readIdentity(fields: ReadonlyMap<string, ts.Expression>, invalid: (reason: string) => never) {
  const id = literalValue(fields.get('id'), 'id', invalid)
  const roundTripId = literalValue(fields.get('roundTripId'), 'roundTripId', invalid)
  const separator = roundTripId.lastIndexOf('@v')
  if (separator < 0 || roundTripId.slice(0, separator) !== id || !/^[1-9][0-9]*$/.test(roundTripId.slice(separator + 2))) {
    return invalid(`roundTripId "${roundTripId}" must be "${id}@v<positive-integer>"`)
  }
  return { id, roundTripId }
}

export function arrayField(
  fields: ReadonlyMap<string, ts.Expression>,
  name: string,
  invalid: (reason: string) => never,
): readonly ts.Expression[] {
  const initializer = fields.get(name)
  if (!initializer) return []
  const literal = unwrap(initializer)
  if (!ts.isArrayLiteralExpression(literal)) return invalid(`expected a literal ${name} array`)
  return literal.elements
}

export function helperArgument(node: ts.Expression, name: string, invalid: (reason: string) => never): ts.Expression {
  const call = unwrap(node)
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== name || call.arguments.length !== 1) {
    return invalid(`expected ${name} with one argument`)
  }
  return call.arguments[0]
}

export function getLocalSectionInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer
    }
  }
  return undefined
}

export function readSectionBuilder(node: ts.Expression, invalid: (reason: string) => never): {
  name: string
  args: readonly ts.Expression[]
} {
  const call = unwrap(node)
  if (!ts.isCallExpression(call)) return invalid('expected a section builder call')
  const builder = call.expression
  if (ts.isIdentifier(builder)) return { name: builder.text, args: call.arguments }
  if (ts.isPropertyAccessExpression(builder) && ts.isIdentifier(builder.expression)) {
    return { name: builder.expression.text + '.' + builder.name.text, args: call.arguments }
  }
  return invalid('expected a named section builder')
}

export function readSectionRuntimeFields(
  initializer: ts.Expression, source: ts.SourceFile, invalid: (reason: string) => never, seen: ReadonlySet<string> = new Set(),
  sourceRoot?: string,
): Map<string, ts.Expression> {
  const value = unwrap(initializer)
  if (ts.isIdentifier(value)) {
    const key = source.fileName + ':' + value.text
    if (seen.has(key)) return invalid(`cyclic section runtime "${value.text}"`)
    const visited = new Set([...seen, key])
    const local = getLocalSectionInitializer(source, value.text)
    if (local) return readSectionRuntimeFields(local, source, invalid, visited, sourceRoot)
    if (sourceRoot) {
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly
            || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        const imported = bindings.elements.find(({ name, isTypeOnly }) => !isTypeOnly && name.text === value.text)
        if (!imported) continue
        const specifier = statement.moduleSpecifier.text
        if (!specifier.startsWith('./') || !stripModuleCodeExtension(specifier).endsWith('.client')) break
        const base = path.resolve(path.dirname(source.fileName), stripModuleCodeExtension(specifier))
        const candidate = MODULE_CODE_EXTENSIONS.map((extension) => base + extension)
          .find((filename) => fs.statSync(filename, { throwIfNoEntry: false })?.isFile())
        if (!candidate) break
        const filename = fs.realpathSync(candidate)
        const relative = path.relative(fs.realpathSync(sourceRoot), filename)
        if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) break
        const dependency = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
        const declaration = exportedDeclaration(dependency, (imported.propertyName ?? imported.name).text)
        if (declaration) return readSectionRuntimeFields(declaration, dependency, invalid, visited, sourceRoot)
        break
      }
    }
    return invalid(`section runtime "${value.text}" must have a local static declaration`)
  }
  if (!ts.isCallExpression(value)) return fieldsOf(value, invalid)
  const { name, args } = readSectionBuilder(value, invalid)
  if (!['defineCrudFormSectionRuntime', 'defineCrudFormFieldGranularSection'].includes(name) || args.length !== 1) {
    return invalid('expected a supported static base section runtime')
  }
  return fieldsOf(args[0], invalid)
}
