import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { asFunction, asValue, createContainer } from 'awilix'
import ts from 'typescript-js'

const root = path.resolve(import.meta.dirname, '../..')
const consumers = [
  ['packages/core/src/bootstrap.ts', 2],
  ['packages/core/src/modules/business_rules/api/execute/[ruleId]/route.ts', 1],
  ['packages/core/src/modules/business_rules/api/execute/route.ts', 2],
  ['packages/core/src/modules/business_rules/api/rules/route.ts', 3],
  ['packages/core/src/modules/workflows/setup.ts', 1],
  ['packages/search/src/modules/search/lib/worker-database.ts', 1],
]

function resolverExpressions(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const expressions = []
  function visit(node) {
    if (ts.isCallExpression(node) && /^(?:ruleEngine\.)?resolveBusinessRule(?:DiscoveryCache|RbacService)$/.test(node.expression.getText(source))) {
      expressions.push(node.arguments[0].getText(source))
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'createScopedBus') {
      expressions.push(node.arguments[0].getText(source))
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'resolve' && node.initializer.getText(source).includes('container.resolve')) {
      expressions.push(node.initializer.getText(source))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return expressions
}

function typeErrors(expressions) {
  const file = path.join(root, 'scripts/__tests__/awilix-resolver-fixture.ts')
  const source = `
    import type { AwilixContainer, ResolveOptions } from 'awilix'
    interface Container {
      resolve: {
        <Key extends keyof { value: string }>(this: void, name: Key, options?: { allowUnregistered?: boolean }): { value: string }[Key]
        <Value>(this: void, name: string | symbol, options?: { allowUnregistered?: boolean }): Value
      }
    }
    declare const container: Container
    declare const caller: Container
    declare const ctx: { container: Container }
    declare const installed: AwilixContainer
    ${expressions.map((expression, index) => `const resolver${index}: <Value = unknown>(name: string) => Value = ${expression}`).join('\n')}
    ${expressions.map((expression, index) => `const installedResolver${index}: <Value = unknown>(name: string) => Value = ${expression.replaceAll('ctx.container', 'installed').replace(/\b(?:caller|container)\b/g, 'installed')}`).join('\n')}
  `
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === file
    ? ts.createSourceFile(file, source, languageVersion, true)
    : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([file], options, host)
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

test('the compatibility fixture rejects binding a no-this resolver and erasing its generic result', () => {
  assert.ok(typeErrors(['container.resolve.bind(container)']).some((message) => message.includes('void')))
  assert.ok(typeErrors(['(name: string): unknown => container.resolve(name)']).some((message) => message.includes('unknown')))
})

for (const [file, count] of consumers) {
  test(`${file} passes generic resolvers compatible with Awilix 13.0.6+`, () => {
    const expressions = resolverExpressions(file)
    assert.equal(expressions.length, count)
    assert.deepEqual(typeErrors(expressions), [])
  })

  test(`${file} callbacks resolve from their own scope and retain optional resolution`, async () => {
    const parent = createContainer()
    parent.register({ value: asValue('parent'), service: asFunction(({ value }) => ({ value })).scoped() })
    const container = parent.createScope()
    container.register({ value: asValue('child') })
    try {
      for (const expression of resolverExpressions(file)) {
        const script = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
        const resolve = vm.runInNewContext(script, { container, caller: container, ctx: { container } })
        assert.equal(resolve('value'), 'child')
        assert.equal(resolve('service'), container.resolve('service'))
        assert.deepEqual(resolve('service'), { value: 'child' })
        assert.equal(resolve('missing', { allowUnregistered: true }), undefined)
        assert.throws(() => resolve('missing'), /Could not resolve/)
      }
    } finally {
      await container.dispose()
      await parent.dispose()
    }
  })
}
