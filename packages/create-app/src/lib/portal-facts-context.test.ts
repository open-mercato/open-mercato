import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const evaluator = await import(new URL('../../agentic/shared/scripts/evaluate-agent-harness.mjs', import.meta.url).href)
const server = fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url))
const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<{
  id: string
  context: { required: string[]; forbidden: string[] }
  expectedRouter: { required: string[]; allowedExtra: string[] }
  maxInitialContextBytes: number
  maxTotalContextBytes: number
}>

for (const caseId of ['OMH-081', 'OMH-133']) {
 test(`${caseId} portal sales routing reads only its actual portal and framework hosts`, () => {
  const record = cases.find(record => record.id === caseId)
  assert.ok(record)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-portal-facts-'))
  const portalFact = '.ai/guides/modules/portal/index.md'
  const unrelatedFact = '.ai/guides/modules/auth/index.md'
  const crmFact = '.ai/guides/modules/customers/index.md'
  const frameworkFact = '.ai/guides/framework-extension-points.md'
  try {
    for (const file of [portalFact, unrelatedFact, crmFact, frameworkFact]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), `# ${file}\n`)
    }
    const allowed = evaluator.caseReadAllowlist(record, false, root)
    const messages = [portalFact, unrelatedFact, crmFact, frameworkFact].map((file, index) => ({
      jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'read', arguments: { path: file } },
    }))
    const result = spawnSync(process.execPath, [server, root, 'read-only', JSON.stringify(allowed), '[]'], {
      input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', env: {},
    })
    assert.equal(result.status, 0, result.stderr)
    const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(replies.length, 4)
    assert.equal(replies[0].result.isError, undefined)
    assert.equal(replies[0].result.content[0].text, `# ${portalFact}\n`)
    assert.equal(replies[1].result.isError, true)
    assert.equal(replies[2].result.isError, true)
    assert.equal(replies[3].result.isError, caseId === 'OMH-081' ? undefined : true)
    if (caseId === 'OMH-081') assert.ok(record.context.required.includes(frameworkFact))
    assert.ok(record.context.required.includes(portalFact))
    assert.ok(record.context.required.includes('.ai/guides/modules/customer_accounts/index.md'))
    assert.ok(record.context.required.includes('.ai/guides/modules/sales/index.md'))
    assert.deepEqual(record.expectedRouter.required, ['module-data', 'backend-ui', 'umes'])
    assert.ok(record.context.forbidden.includes('.env*'))
    assert.ok(record.context.forbidden.includes('.git/**'))
    assert.equal(record.maxInitialContextBytes, 57_344)
    assert.equal(record.maxTotalContextBytes, caseId === 'OMH-081' ? 397_312 : 356_352)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

}

test('portal principal scope stays distinct from staff authentication and CRM host work', () => {
  for (const relative of ['../../agentic/shared/AGENTS.md.template', '../../template/AGENTS.md']) {
    const root = fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
    assert.match(root, /Hosts: staff session\/auth→auth; CRM customer\/contact\/deal\/pipeline→customers/)
    assert.match(root, /portal→portal\+customer_accounts/)
    assert.match(root, /Derive trusted `tenantId` \+ `organizationId`; fail closed/)
    assert.match(root, /Contract-surface changes .*BACKWARD_COMPATIBILITY/)
  }
})


test('customer-principal API adapters require domain owners while pure installed guards stay slim', () => {
  for (const relative of ['../../agentic/shared/AGENTS.md.template', '../../template/AGENTS.md']) {
    const root = fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
    assert.match(root, /\| `module-data` \| App-owned domain\/data\/API; customer-principal API adapters for staff-only hosts \|/)
    assert.match(root, /app-owned persistence\/API adapters = `module-data`/)
    assert.match(root, /installed guards without either = `umes` only: skip contracts/)
    assert.match(root, /Installed form\/table fields\/filters\/row\/bulk actions without app persistence\/API = `umes` \+ `backend-ui` only/)
    assert.match(root, /read `crud-surfaces` \+ `quality-states`; skip contracts\/module-scaffold\/page\/navigation/)
    assert.match(root, /merely hiding\/toggling\/rewiring installed UI does not/)
    assert.match(root, /portal→portal\+customer_accounts/)
  }
})
