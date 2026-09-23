import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const SUPERVISOR_SOURCE = path.join(process.cwd(), 'scripts', 'dev-runtime-state.mjs')
const APP_SOURCE = path.join(process.cwd(), 'packages', 'shared', 'src', 'lib', 'dev-runtime', 'redaction.ts')
const TEMPLATE_APP_SOURCE = path.join(
  process.cwd(),
  'packages', 'create-app', 'template', 'scripts', 'dev-runtime-state.mjs',
)

function extractRules(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const start = source.indexOf('const REDACTION_RULES')
  assert.notEqual(start, -1, `${filePath} must declare REDACTION_RULES`)
  const bodyStart = source.indexOf('[\n', start)
  const bodyEnd = source.indexOf('\n]', bodyStart)
  assert.notEqual(bodyEnd, -1, `${filePath} must close REDACTION_RULES`)
  return source.slice(bodyStart + 2, bodyEnd).trimEnd()
}

// The supervisor and the dev-only app route redact independently, so their rule
// lists MUST stay identical. A drift here means the browser collector can write
// a secret to the local sink that the supervisor would have stripped.
test('the app redaction rules mirror the supervisor rules exactly', () => {
  assert.equal(extractRules(APP_SOURCE), extractRules(SUPERVISOR_SOURCE))
})

test('the standalone template mirrors the supervisor redaction rules', (t) => {
  if (!fs.existsSync(TEMPLATE_APP_SOURCE)) {
    t.skip('template dev-runtime-state.mjs is not present')
    return
  }
  assert.equal(extractRules(TEMPLATE_APP_SOURCE), extractRules(SUPERVISOR_SOURCE))
})
