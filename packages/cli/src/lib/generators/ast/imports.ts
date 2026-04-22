import ts from 'typescript'
import {
  StructureKind,
  type ImportDeclarationStructure,
  type OptionalKind,
  type SourceFile,
} from 'ts-morph'

export type GeneratedImportSpec = OptionalKind<ImportDeclarationStructure>

function toImportSpec(statement: string): GeneratedImportSpec {
  const trimmed = statement.trim()
  const sourceFile = ts.createSourceFile('import.ts', trimmed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importDeclaration = sourceFile.statements.find(ts.isImportDeclaration)
  if (!importDeclaration) {
    throw new Error(`Expected import declaration, received: ${statement}`)
  }

  const moduleSpecifier = importDeclaration.moduleSpecifier
  if (!ts.isStringLiteral(moduleSpecifier)) {
    throw new Error(`Unsupported import declaration: ${statement}`)
  }

  const spec: GeneratedImportSpec = {
    kind: StructureKind.ImportDeclaration,
    moduleSpecifier: moduleSpecifier.text,
  }

  const clause = importDeclaration.importClause
  if (!clause) {
    return spec
  }

  spec.isTypeOnly = clause.isTypeOnly

  if (clause.name) {
    spec.defaultImport = clause.name.text
  }

  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    spec.namespaceImport = clause.namedBindings.name.text
  }

  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    spec.namedImports = clause.namedBindings.elements.map((element) => ({
      kind: StructureKind.ImportSpecifier,
      name: element.propertyName?.text ?? element.name.text,
      alias: element.propertyName ? element.name.text : undefined,
      isTypeOnly: element.isTypeOnly,
    }))
  }

  return spec
}

export function addImportSpec(sourceFile: SourceFile, spec: GeneratedImportSpec): void {
  sourceFile.addImportDeclaration({
    kind: StructureKind.ImportDeclaration,
    ...spec,
  })
}

export function addImportSpecs(sourceFile: SourceFile, specs: GeneratedImportSpec[]): void {
  for (const spec of specs) {
    addImportSpec(sourceFile, spec)
  }
}

export function addImportStatement(sourceFile: SourceFile, statement: string): void {
  const trimmed = statement.trim()
  if (!trimmed) return
  addImportSpec(sourceFile, toImportSpec(trimmed))
}

export function addImportStatements(sourceFile: SourceFile, statements: string[]): void {
  for (const statement of statements) {
    addImportStatement(sourceFile, statement)
  }
}
