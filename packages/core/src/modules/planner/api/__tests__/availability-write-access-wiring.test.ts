import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'

const API_ROOT = resolve(__dirname, '..')
const WRITE_ACTIONS = ['create', 'update', 'delete'] as const
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE'])

function parseRoute(fileName: string): ts.SourceFile {
  const source = readFileSync(resolve(API_ROOT, fileName), 'utf8')
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

function findObjectProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  if (!property) throw new Error(`Missing ${name} property`)
  return property
}

function findCallPositions(node: ts.Node, matches: (call: ts.CallExpression) => boolean): number[] {
  const positions: number[] = []
  const visit = (candidate: ts.Node) => {
    if (ts.isCallExpression(candidate) && matches(candidate)) positions.push(candidate.getStart())
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return positions
}

function isIdentifierCall(call: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(call.expression) && call.expression.text === name
}

function isCommandBusExecute(call: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'commandBus' &&
    call.expression.name.text === 'execute'
  )
}

function findCrudMapInputs(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  let config: ts.ObjectLiteralExpression | null = null
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'makeCrudRoute' &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      config = node.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!config) throw new Error('Missing makeCrudRoute configuration')

  const actionsInitializer = findObjectProperty(config, 'actions').initializer
  if (!ts.isObjectLiteralExpression(actionsInitializer)) throw new Error('actions must be an object literal')

  const mapInputs = new Map<string, ts.Expression>()
  for (const action of WRITE_ACTIONS) {
    const actionInitializer = findObjectProperty(actionsInitializer, action).initializer
    if (!ts.isObjectLiteralExpression(actionInitializer)) throw new Error(`${action} action must be an object literal`)
    mapInputs.set(action, findObjectProperty(actionInitializer, 'mapInput').initializer)
  }
  return mapInputs
}

describe('planner availability write authorization wiring (#3883)', () => {
  test('every CRUD mapInput keeps the relocated access assertion before returning to the write factory', () => {
    const sourceFile = parseRoute('availability.ts')
    const mapInputs = findCrudMapInputs(sourceFile)
    const minimumGuardCalls: Record<(typeof WRITE_ACTIONS)[number], number> = {
      create: 1,
      update: 2,
      delete: 1,
    }

    expect([...mapInputs.keys()].sort()).toEqual([...WRITE_ACTIONS].sort())
    for (const action of WRITE_ACTIONS) {
      const mapInput = mapInputs.get(action)
      if (!mapInput) throw new Error(`Missing ${action} mapInput`)
      const guardCalls = findCallPositions(mapInput, (call) => isIdentifierCall(call, 'assertAvailabilityWriteAccess'))
      const returns: number[] = []
      const collectReturns = (node: ts.Node) => {
        if (ts.isReturnStatement(node)) returns.push(node.getStart())
        ts.forEachChild(node, collectReturns)
      }
      collectReturns(mapInput)

      expect(guardCalls.length).toBeGreaterThanOrEqual(minimumGuardCalls[action])
      expect(returns.length).toBeGreaterThan(0)
      expect(Math.min(...guardCalls)).toBeLessThan(Math.min(...returns))
    }
  })

  test('every custom write handler asserts access before command execution', () => {
    const routeFiles = ['availability-weekly.ts', 'availability-date-specific.ts']
    const guardedHandlers: string[] = []

    for (const fileName of routeFiles) {
      const sourceFile = parseRoute(fileName)
      for (const statement of sourceFile.statements) {
        if (
          !ts.isFunctionDeclaration(statement) ||
          !statement.name ||
          !WRITE_METHODS.has(statement.name.text) ||
          !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
          !statement.body
        ) {
          continue
        }

        const guardCalls = findCallPositions(statement.body, (call) =>
          isIdentifierCall(call, 'assertAvailabilityWriteAccess'),
        )
        const writeCalls = findCallPositions(statement.body, isCommandBusExecute)
        guardedHandlers.push(`${fileName}:${statement.name.text}`)

        expect(guardCalls.length).toBeGreaterThan(0)
        expect(writeCalls.length).toBeGreaterThan(0)
        expect(Math.min(...guardCalls)).toBeLessThan(Math.min(...writeCalls))
      }
    }

    expect(guardedHandlers.sort()).toEqual([
      'availability-date-specific.ts:POST',
      'availability-weekly.ts:POST',
    ])
  })
})
