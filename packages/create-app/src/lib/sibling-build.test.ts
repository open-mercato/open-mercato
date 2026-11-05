import assert from 'node:assert/strict'
import test from 'node:test'
import { describeMissingSiblingBuild } from '../../scripts/sibling-build.mjs'

// The package build now runs before the test runner, so a tree with uncompiled siblings fails at
// build time — ahead of requirePackageBuild(). Without a message of its own that failure is a bare
// ERR_MODULE_NOT_FOUND stack and zero tests, which is the illegible failure mode #5052 is about.

test('a missing sibling build is named with the command that fixes it', () => {
  const moduleNotFound = Object.assign(
    new Error("Cannot find module '/repo/node_modules/@open-mercato/cli/dist/lib/generators/module-facts.js'"),
    { code: 'ERR_MODULE_NOT_FOUND' },
  )

  const described = describeMissingSiblingBuild(moduleNotFound)

  assert.ok(described instanceof Error)
  assert.match(described.message, /yarn build:packages/)
  assert.equal(described.cause, moduleNotFound, 'the original resolution error stays attached')
})

test('unrelated build failures are left alone', () => {
  const syntaxError = Object.assign(new Error('Unexpected token'), { code: 'ERR_INVALID_ARG_TYPE' })

  assert.equal(describeMissingSiblingBuild(syntaxError), null)
  assert.equal(describeMissingSiblingBuild(new Error('boom')), null)
  assert.equal(describeMissingSiblingBuild(undefined), null)
})
