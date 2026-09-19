import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'

const PAGE_PATH = resolve(__dirname, '..', '[id]', 'page.tsx')
const COMPONENT_NAME = 'SalesDocumentDetailPage'
const HOOKS_WITH_DEPENDENCIES = new Set([
  'useCallback',
  'useEffect',
  'useImperativeHandle',
  'useLayoutEffect',
  'useMemo',
])

type Reference = { name: string; position: number; line: number }

function parsePage(): ts.SourceFile {
  const source = readFileSync(PAGE_PATH, 'utf8')
  return ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function findComponent(sourceFile: ts.SourceFile): ts.FunctionDeclaration {
  const component = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === COMPONENT_NAME,
  )
  if (!component?.body) throw new Error(`Missing ${COMPONENT_NAME} component body`)
  return component
}

function collectBoundNames(name: ts.BindingName, into: string[]): void {
  if (ts.isIdentifier(name)) {
    into.push(name.text)
    return
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBoundNames(element.name, into)
  }
}

/**
 * Positions of the component's own `const` / `let` bindings. A binding used
 * before this position is in its temporal dead zone.
 */
function collectDeclarationPositions(component: ts.FunctionDeclaration): Map<string, number> {
  const positions = new Map<string, number>()
  for (const statement of component.body!.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (!(statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) continue
    for (const declaration of statement.declarationList.declarations) {
      const names: string[] = []
      collectBoundNames(declaration.name, names)
      for (const name of names) {
        if (!positions.has(name)) positions.set(name, statement.getStart())
      }
    }
  }
  return positions
}

function hookName(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression)) return call.expression.text
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text
  return null
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | null {
  let current: ts.Expression = expression
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return ts.isIdentifier(current) ? current : null
}

/**
 * Every identifier read inside a hook dependency array. Unlike the hook
 * callback bodies, these are evaluated on every render.
 */
function collectDependencyReferences(sourceFile: ts.SourceFile, component: ts.FunctionDeclaration): Reference[] {
  const references: Reference[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = hookName(node)
      const dependencies = node.arguments[node.arguments.length - 1]
      if (name && HOOKS_WITH_DEPENDENCIES.has(name) && dependencies && ts.isArrayLiteralExpression(dependencies)) {
        for (const element of dependencies.elements) {
          const identifier = rootIdentifier(element)
          if (!identifier) continue
          const position = identifier.getStart()
          references.push({
            name: identifier.text,
            position,
            line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(component.body!)
  return references
}

describe(`${COMPONENT_NAME} hook declaration order`, () => {
  const sourceFile = parsePage()
  const component = findComponent(sourceFile)
  const declarationPositions = collectDeclarationPositions(component)

  it('reads no component binding inside a hook dependency array before that binding is declared', () => {
    const violations = collectDependencyReferences(sourceFile, component)
      .filter((reference) => {
        const declaredAt = declarationPositions.get(reference.name)
        return declaredAt !== undefined && reference.position < declaredAt
      })
      .map((reference) => {
        const declaredAt = declarationPositions.get(reference.name)!
        const declarationLine = sourceFile.getLineAndCharacterOfPosition(declaredAt).line + 1
        return `'${reference.name}' is read on line ${reference.line} but declared on line ${declarationLine}`
      })

    expect(violations).toEqual([])
  })

  it('declares fetchDocumentByKind and recalculatingTax before handleRecalculateTax', () => {
    const fetchDocumentByKind = declarationPositions.get('fetchDocumentByKind')
    const recalculatingTax = declarationPositions.get('recalculatingTax')
    const handleRecalculateTax = declarationPositions.get('handleRecalculateTax')

    expect(fetchDocumentByKind).toBeDefined()
    expect(recalculatingTax).toBeDefined()
    expect(handleRecalculateTax).toBeDefined()
    expect(fetchDocumentByKind!).toBeLessThan(handleRecalculateTax!)
    expect(recalculatingTax!).toBeLessThan(handleRecalculateTax!)
  })
})
