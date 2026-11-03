import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  analyzeFile,
  collectAsFunctionRegistrations,
  collectRegisteredKeys,
} from '../lib/classic-di-injection.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml')

function analyze(source, extraKeys = []) {
  const knownKeys = new Set([...collectRegisteredKeys(source), ...extraKeys])
  return analyzeFile({ file: 'dist/di.js', source, knownKeys })
}

// The exact shape esbuild emitted for the registration that shipped broken:
// the factory parameter shadowed an enclosing `const em`, so the bundler
// renamed it and the container was asked for a key nobody registers.
test('flags a factory parameter renamed by the bundler', () => {
  const violations = analyze(`
    container.register({
      em: asValue(em),
      crudMutationGuardService: asFunction(
        (em2) => createOptimisticLockGuardService({ getEm: () => em2 })
      ).scoped()
    });
  `)

  assert.equal(violations.length, 1)
  assert.equal(violations[0].kind, 'unregistered-parameter')
  assert.equal(violations[0].key, 'crudMutationGuardService')
  assert.equal(violations[0].parameter, 'em2')
})

test('accepts the parameterless closure form', () => {
  const violations = analyze(`
    container.register({
      em: asValue(em),
      crudMutationGuardService: asFunction(
        () => createOptimisticLockGuardService({ getEm: () => em })
      ).scoped()
    });
  `)

  assert.deepEqual(violations, [])
})

test('accepts positional parameters that name a registered key', () => {
  const violations = analyze(`
    container.register({ em: asValue(em), rbacService: asClass(RbacService).scoped() });
    container.register({
      recordLockService: asFunction((em, rbacService) => make(em, rbacService)).scoped()
    });
  `)

  assert.deepEqual(violations, [])
})

// CLASSIC passes dependencies positionally, so a destructuring factory without
// `.proxy()` destructures the first dependency instead of the cradle. Awilix
// throws nothing — every field is simply undefined.
test('flags a destructured factory that did not opt into proxy injection', () => {
  const violations = analyze(`
    container.register({
      catalogPricingService: asFunction(({ eventBus }) => make(eventBus)).scoped()
    });
  `, ['eventBus'])

  assert.equal(violations.length, 1)
  assert.equal(violations[0].kind, 'destructured-without-proxy')
  assert.equal(violations[0].key, 'catalogPricingService')
})

test('accepts a destructured factory registered with proxy injection', () => {
  const violations = analyze(`
    container.register({
      catalogPricingService: asFunction(({ eventBus }) => make(eventBus)).scoped().proxy()
    });
  `, ['eventBus'])

  assert.deepEqual(violations, [])
})

test('ignores a factory passed by reference, whose parameters are declared elsewhere', () => {
  const source = `container.register({ workflowExecutor: asFunction(makeExecutor).scoped() });`

  assert.equal(collectAsFunctionRegistrations(source)[0].parameters, null)
  assert.deepEqual(analyze(source), [])
})

test('handles named function factories and paren-less arrows', () => {
  const named = analyze(`
    container.register({
      em: asValue(em),
      rbacService: asFunction(function rbacServiceFactory(em) { return new RbacService(em) }).scoped()
    });
  `)
  assert.deepEqual(named, [])

  const arrow = analyze(`container.register({ svc: asFunction(missingKey => make(missingKey)).scoped() });`)
  assert.equal(arrow.length, 1)
  assert.equal(arrow[0].parameter, 'missingKey')
})

test('collects registration keys across every resolver kind', () => {
  const keys = collectRegisteredKeys(`
    container.register({
      em: asValue(em),
      authService: asClass(AuthService).scoped(),
      rbacService: asFunction(() => make()).scoped(),
      legacyEm: aliasTo('em')
    });
  `)

  assert.deepEqual([...keys].sort(), ['authService', 'em', 'legacyEm', 'rbacService'])
})

// The guard only has value if CI runs it against built output. Pin the wiring
// so a workflow edit cannot quietly drop it.
test('CI runs the guard after the build artifacts are available', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /yarn check:classic-di-injection/)

  const downloadIndex = workflow.indexOf('name: Download build artifacts')
  const guardIndex = workflow.indexOf('yarn check:classic-di-injection')
  assert.ok(downloadIndex !== -1, 'expected a build-artifact download step')
  assert.ok(
    downloadIndex < guardIndex,
    'the guard reads packages/*/dist and must run after build artifacts are downloaded',
  )
})
