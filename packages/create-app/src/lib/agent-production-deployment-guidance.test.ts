import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const createAppRoot = fileURLToPath(new URL('../../', import.meta.url))
const agenticRoot = path.join(createAppRoot, 'agentic')
const guidePath = path.join(agenticRoot, 'guides', 'production-deployment.md')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(createAppRoot, relativePath), 'utf8')
}

test('standalone production requests route to one TLS-first secrets-safe guide', () => {
  assert.equal(fs.existsSync(guidePath), true, 'missing routed production deployment guide')

  const guide = fs.readFileSync(guidePath, 'utf8')
  const roots = [
    read('agentic/shared/AGENTS.md.template'),
    read('template/AGENTS.md'),
  ]
  for (const root of roots) {
    assert.match(root, /production deployment|go-live|production readiness/i)
    assert.match(root, /route.{0,80}`architecture`/i)
    assert.match(root, /\.ai\/guides\/production-deployment\.md/)
    assert.match(root, /\.env\.example/)
    assert.match(root, /during routing.{0,80}do not open `?\.env\*/i)
    assert.match(root, /never read or report live `?\.env/i)
    assert.match(root, /ask before.{0,120}(?:credentials|billable infrastructure|live deployment)/i)
  }

  const orderedHeadings = [...guide.matchAll(/^## ([0-9]+)\. (.+)$/gm)].map((match) => ({
    order: Number(match[1]),
    title: match[2],
  }))
  assert.equal(orderedHeadings[0]?.order, 1)
  assert.match(orderedHeadings[0]?.title ?? '', /HTTPS|TLS/)
  assert.deepEqual(orderedHeadings.map(({ order }) => order), orderedHeadings.map((_, index) => index + 1))
  for (const expected of [
    /DNS|domain|certificate|reverse proxy/i,
    /environment|secret/i,
    /infrastructure|database|Redis|search/i,
    /backup|restore|recovery/i,
    /access|RBAC|MFA|CORS|webhook/i,
    /worker|queue|storage/i,
    /observability|logging|telemetry|alert/i,
    /validation|staging|health/i,
    /rollout|rollback/i,
  ]) assert.match(guide, expected)
  assert.match(guide, /required/i)
  assert.match(guide, /recommended/i)
  assert.match(guide, /module-specific/i)
  assert.match(guide, /do not read.{0,80}\.env/i)
  assert.match(guide, /do not.{0,80}(?:perform|claim).{0,80}live deployment/i)
})

test('OMH-238 enforces the production-readiness routing and safety contract', () => {
  const cases = JSON.parse(read('agentic/shared/ai/harness/cases.json')) as Array<{
    id: string
    owner: { path: string }
    context: { required: string[]; allowedExtra: string[]; forbidden: string[] }
    requiredDecisions: string[]
    forbiddenPatterns: string[]
  }>
  const productionCase = cases.find(({ id }) => id === 'OMH-238')
  assert.ok(productionCase)
  assert.equal(productionCase.owner.path, '.ai/guides/production-deployment.md')
  assert.deepEqual(productionCase.context.required, ['AGENTS.md', '.ai/guides/production-deployment.md'])
  assert.deepEqual(productionCase.context.allowedExtra, [])
  assert.ok(productionCase.context.forbidden.includes('.env*'))
  for (const decision of [
    'https-tls-first',
    'env-example-names-only',
    'secret-manager-and-rotation',
    'production-infrastructure-and-data-protection',
    'access-controls-and-edge-security',
    'workers-durable-storage-and-observability',
    'staging-validation-and-health-checks',
    'rollout-and-rollback',
    'ask-before-live-or-billable-actions',
    'honest-unrun-checks',
  ]) assert.ok(productionCase.requiredDecisions.includes(decision), `missing production decision ${decision}`)
  assert.ok(productionCase.forbiddenPatterns.some((pattern) => pattern.includes('\\.env')))
})
