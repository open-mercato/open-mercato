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

test('progressive data references pin encryption, atomicity, undo, and optimistic-lock helpers', () => {
  const sensitiveData = readAgentic(
    'shared/ai/skills/om-data-model-design/references/sensitive-data.md',
  )
  assert.match(sensitiveData, /@open-mercato\/shared\/lib\/encryption\/find/)
  assert.match(sensitiveData, /findWithDecryption/)
  assert.match(sensitiveData, /findOneWithDecryption/)
  assert.match(sensitiveData, /findAndCountWithDecryption/)
  assert.match(sensitiveData, /query `where`/)
  assert.match(sensitiveData, /fifth-argument decryption scope/)
  assert.match(sensitiveData, /hash-only/)

  const integrity = readAgentic(
    'shared/ai/skills/om-data-model-design/references/integrity-and-concurrency.md',
  )
  assert.match(integrity, /@open-mercato\/shared\/lib\/commands\/flush/)
  assert.match(integrity, /withAtomicFlush/)
  assert.match(integrity, /transaction: true/)
  assert.match(integrity, /same `EntityManager`/)
  assert.match(integrity, /@open-mercato\/shared\/lib\/commands\/undo/)
  assert.match(integrity, /extractUndoPayload/)
  assert.match(integrity, /enforceCommandOptimisticLock/)
  assert.match(integrity, /after commit/)
})

test('progressive module references pin search, i18n, and intentional extension hosts', () => {
  const moduleSurfaces = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/module-surfaces.md',
  )
  assert.match(moduleSurfaces, /`search\.ts`/)
  assert.match(moduleSurfaces, /fieldPolicy/)
  assert.match(moduleSurfaces, /checksumSource/)
  assert.match(moduleSurfaces, /formatResult/)
  assert.match(moduleSurfaces, /`indexer: \{ entityType \}`/)
  assert.match(moduleSurfaces, /deterministic convergence/)

  const apiAndDomain = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/api-and-domain.md',
  )
  assert.match(apiAndDomain, /enrichers: \{ entityId: '<module>:<entity>' \}/)
  assert.match(apiAndDomain, /stable host contract/)

  const crudSurfaces = readAgentic(
    'shared/ai/skills/om-backend-ui-design/references/crud-surfaces.md',
  )
  assert.match(crudSurfaces, /authoring a new host UI/)
  assert.match(crudSurfaces, /extensionTableId/)
  assert.match(crudSurfaces, /stable column, action, and row-action IDs/)

  const discoveryCatalog = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/discovery-surface-catalog.md',
  )
  assert.match(discoveryCatalog, /`i18n\/<locale>\.json`/)
  assert.match(discoveryCatalog, /`translations\.ts`/)
})

test('progressive AI reference pins generated registration and approval-gated command writes', () => {
  const moduleAi = readAgentic(
    'shared/ai/skills/om-create-ai-agent/references/module-agents-and-tools.md',
  )
  assert.match(moduleAi, /`ai-agents\.ts`\/`ai-tools\.ts`/)
  assert.match(moduleAi, /`prepareMutation`/)
  assert.match(moduleAi, /dispatches a command with optimistic locking/)
  assert.match(moduleAi, /No write occurs before approval/)
  assert.match(moduleAi, /Run `yarn generate`/)
})
