import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// The production-documented stacks. Their `.dev.yml` sibling is deliberately excluded: it is the
// local development stack, where a throwaway secret and development mode are the point.
const PRODUCTION_COMPOSE_FILES = [
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]

function read(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

for (const relPath of PRODUCTION_COMPOSE_FILES) {
  test(`${relPath} never supplies a default JWT_SECRET`, () => {
    const content = read(relPath)
    const assignments = content.match(/^\s*JWT_SECRET:.*$/gm) ?? []
    assert.ok(assignments.length > 0, `No JWT_SECRET assignment found in ${relPath}`)
    for (const line of assignments) {
      assert.ok(
        !/\$\{JWT_SECRET:-/.test(line),
        `${relPath} falls back to a literal signing secret (${line.trim()}) — anyone reading this `
        + 'repository could then forge tokens for a deployment that kept the default. Require the '
        + 'variable with ${JWT_SECRET:?...} instead.',
      )
      assert.ok(
        /\$\{JWT_SECRET:\?/.test(line),
        `${relPath} must require JWT_SECRET via \${JWT_SECRET:?...} so the stack refuses to start `
        + `without one, got: ${line.trim()}`,
      )
    }
  })

  test(`${relPath} does not force development mode`, () => {
    const content = read(relPath)
    const assignments = content.match(/^\s*NODE_ENV:.*$/gm) ?? []
    assert.ok(assignments.length > 0, `No NODE_ENV assignment found in ${relPath}`)
    for (const line of assignments) {
      assert.ok(
        !/NODE_ENV:\s*development\s*$/.test(line),
        `${relPath} pins NODE_ENV to development (${line.trim()}), which downgrades a production `
        + 'image and disables production-only safety checks. Default to production instead.',
      )
    }
  })

  test(`${relPath} passes the bounded legacy-token controls into every JWT consumer`, () => {
    const content = read(relPath)
    const jwtAssignments = content.match(/^\s*JWT_SECRET:.*$/gm) ?? []
    const graceAssignments = content.match(/^\s*JWT_LEGACY_GRACE_MINUTES:.*$/gm) ?? []
    const cutoverAssignments = content.match(/^\s*JWT_LEGACY_CUTOVER_AT:.*$/gm) ?? []
    assert.equal(graceAssignments.length, jwtAssignments.length)
    assert.equal(cutoverAssignments.length, jwtAssignments.length)
    for (const line of graceAssignments) {
      assert.match(line, /\$\{JWT_LEGACY_GRACE_MINUTES:-480\}/)
    }
    for (const line of cutoverAssignments) {
      assert.match(line, /\$\{JWT_LEGACY_CUTOVER_AT:-\}/)
    }
  })
}
