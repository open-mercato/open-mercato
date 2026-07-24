import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))
const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url))

function readAgentic(relativePath: string): string {
  return fs.readFileSync(path.join(agenticRoot, relativePath), 'utf8')
}

function readPackage(relativePath: string): string {
  return fs.readFileSync(path.join(packagesRoot, relativePath), 'utf8')
}

test('standalone module contracts require structured runtime logging without banning script output', () => {
  const contracts = readAgentic('guides/contracts.md')
  assert.match(contracts, /createLogger\('<module>'\)/)
  assert.match(contracts, /\.child\(\{ component, \.\.\.context \}\)/)
  assert.match(contracts, /dynamic values in structured metadata/)
  assert.match(contracts, /credentials, tokens, secrets, PII, and payload bodies/)
  assert.match(contracts, /Do not add raw `console\.\*` calls to runtime\/server\/module code/)
  assert.match(contracts, /CLI\/build scripts and test-local console spies remain valid/)
})

test('installed auth and onboarding context directs new routes to current contracts', () => {
  const auth = readPackage('core/src/modules/auth/AGENTS.md')
  assert.match(auth, /API metadata is per HTTP method/)
  assert.match(auth, /GET: \{ requireAuth: true, requireFeatures: \['auth\.users\.list'\] \}/)
  assert.doesNotMatch(auth, /^\s*requireRoles:/m)
  assert.match(auth, /`requireRoles` remains a deprecated compatibility field/)

  const onboarding = readPackage('onboarding/AGENTS.md')
  assert.match(onboarding, /Existing `api\/get\/\*\*` and `api\/post\/\*\*` files are legacy compatibility routes/)
  assert.match(onboarding, /`api\/<step>\/get\|post\/route\.ts` as legacy/)
  assert.match(onboarding, /Create `api\/<step-name>\/route\.ts` and export sibling `GET` and `POST` handlers/)
  assert.doesNotMatch(onboarding, /Add GET endpoint in `api\/<step-name>\/get\/route\.ts`/)
})
