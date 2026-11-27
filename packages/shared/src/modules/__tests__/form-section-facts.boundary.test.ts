import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript-js'

describe('CrudForm section facts package boundary', () => {
  it('declares only types and uses the shared override type as its only dependency', () => {
    const filename = resolve(__dirname, '../form-section-facts.ts')
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    const dependencies: string[] = []

    function inspect(node: ts.Node): void {
      if (ts.isImportTypeNode(node)) dependencies.push(node.argument.getText(source))
      ts.forEachChild(node, inspect)
    }

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        expect(statement.importClause?.isTypeOnly).toBe(true)
        dependencies.push(statement.moduleSpecifier.getText(source))
      } else {
        expect(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)).toBe(true)
      }
      inspect(statement)
    }

    expect(dependencies).toEqual(["'./overrides'"])
  })
})
