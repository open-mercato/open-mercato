import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  EXCLUDED_MUTATIONS,
  MUTATION_REPORT_PATH,
  PACKAGE_TIMEOUT_MS,
  createStrykerConfig,
} from '../stryker/createConfig.mjs'

test('produces the expected configuration for a given package name', () => {
  const config = createStrykerConfig({ packageName: 'shared' })

  assert.equal(config.packageManager, 'yarn')
  assert.equal(config.testRunner, 'jest')
  assert.equal(config.jest.projectType, 'custom')
  assert.equal(config.jest.configFile, 'jest.config.cjs')
  assert.equal(config.jest.enableFindRelatedTests, true)
  assert.equal(config.jest.config.testEnvironment, '@stryker-mutator/jest-runner/jest-env/node')
  assert.equal(config.jsonReporter.fileName, MUTATION_REPORT_PATH)
  assert.deepEqual(config.reporters, ['clear-text', 'progress', 'json'])
  assert.equal(config.concurrency, DEFAULT_CONCURRENCY)
  assert.equal(config.timeoutFactor, 2)
  assert.equal(config.cleanTempDir, true)
})

test('forces inPlace, because the sandbox breaks the per-package jest config', () => {
  assert.equal(createStrykerConfig({ packageName: 'shared' }).inPlace, true)
})

test('keeps coverageAnalysis off, because @jest-environment docblocks block perTest', () => {
  assert.equal(createStrykerConfig({ packageName: 'shared' }).coverageAnalysis, 'off')
})

test('excludes the mutators that reward asserting exact strings', () => {
  const { mutator } = createStrykerConfig({ packageName: 'shared' })

  assert.deepEqual(mutator.excludedMutations, [...EXCLUDED_MUTATIONS])
  assert.ok(mutator.excludedMutations.includes('StringLiteral'))
  assert.ok(mutator.excludedMutations.includes('Regex'))
})

test('mutates business logic but never tests, type declarations, or test helpers', () => {
  const { mutate } = createStrykerConfig({ packageName: 'shared' })

  assert.ok(mutate.includes('src/lib/**/*.ts'))
  assert.ok(mutate.includes('src/modules/**/*.ts'))
  assert.ok(mutate.includes('!src/**/__tests__/**'))
  assert.ok(mutate.includes('!src/**/*.test.ts'))
  assert.ok(mutate.includes('!src/**/*.d.ts'))
  assert.ok(mutate.includes('!src/lib/testing/**'))
})

test('ships advisory — no break threshold until enforcement is explicitly enabled', () => {
  assert.equal(createStrykerConfig({ packageName: 'shared' }).thresholds.break, null)
})

test('gives packages/core the larger timeout its 30s jest testTimeout requires', () => {
  assert.equal(createStrykerConfig({ packageName: 'core' }).timeoutMS, PACKAGE_TIMEOUT_MS.core)
  assert.equal(createStrykerConfig({ packageName: 'shared' }).timeoutMS, DEFAULT_TIMEOUT_MS)
})

test('lets an explicit timeoutMS override the per-package default', () => {
  assert.equal(createStrykerConfig({ packageName: 'core', timeoutMS: 1234 }).timeoutMS, 1234)
})

test('rejects a missing or blank package name instead of guessing', () => {
  assert.throws(() => createStrykerConfig(), /packageName/)
  assert.throws(() => createStrykerConfig({}), /packageName/)
  assert.throws(() => createStrykerConfig({ packageName: '   ' }), /packageName/)
})

test('does not share mutable arrays between two generated configs', () => {
  const first = createStrykerConfig({ packageName: 'shared' })
  const second = createStrykerConfig({ packageName: 'shared' })

  first.mutate.push('src/should-not-leak.ts')
  first.mutator.excludedMutations.push('ArithmeticOperator')

  assert.ok(!second.mutate.includes('src/should-not-leak.ts'))
  assert.ok(!second.mutator.excludedMutations.includes('ArithmeticOperator'))
})
