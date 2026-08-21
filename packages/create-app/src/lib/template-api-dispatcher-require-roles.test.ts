import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const templateDispatcherUrl = new URL(
  '../../template/src/app/api/[...slug]/route.ts',
  import.meta.url,
)
const monorepoDispatcherUrl = new URL(
  '../../../../apps/mercato/src/app/api/[...slug]/route.ts',
  import.meta.url,
)

function readSource(url: URL): string {
  return fs.readFileSync(url, 'utf8')
}

test('template API dispatcher no longer enforces the deprecated requireRoles guard', () => {
  const source = readSource(templateDispatcherUrl)

  // The old, spoofable role gate compared mutable role names and returned 403.
  // It must be gone — role names must never authorize a request.
  assert.doesNotMatch(
    source,
    /requiredRoles\.some\(\(role\) => auth\.roles!\.includes\(role\)\)/,
    'dispatcher must not authorize based on mutable role-name matching',
  )
  assert.doesNotMatch(
    source,
    /\{ error: t\('api\.errors\.forbidden', 'Forbidden'\), requiredRoles \}/,
    'dispatcher must not return a requireRoles-driven 403',
  )

  // A declared requireRoles guard is now advisory only and emits a deprecation warning.
  assert.match(
    source,
    /warnDeprecatedRequireRoles/,
    'dispatcher must warn when a route still declares requireRoles',
  )
  assert.match(
    source,
    /requireFeatures/,
    'dispatcher must keep the feature-based authorization path',
  )
})

test('template API dispatcher stays byte-identical to the monorepo dispatcher (template sync)', () => {
  assert.equal(
    readSource(templateDispatcherUrl),
    readSource(monorepoDispatcherUrl),
    'template and monorepo API dispatchers must stay in sync',
  )
})
