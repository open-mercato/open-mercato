import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const astOracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-ast-oracles.mjs', import.meta.url))
const behaviorOracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-behavior-oracles.mjs', import.meta.url))
const fixtureIndexPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/fixtures/index.json', import.meta.url))
const seedsPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/fixtures/seeds.json', import.meta.url))
const typescriptRoot = path.dirname(require.resolve('typescript/package.json'))

type Family =
  | 'business-command'
  | 'ui-business-surface'
  | 'async-operation'
  | 'ai-safe-agent'
  | 'provider-adapter'
  | 'data-flow'
  | 'test-authoring-mutation'
  | 'regression'

type CaseDefinition = {
  fixture: string
  file: string
  family: Family
  validator: string
  seam?: string
  handler?: string
  requiredFlags?: string[]
  mode?: 'mutation' | 'delegate'
}

type OracleResult = {
  passed: boolean
  failures: string[]
  checks: Array<{ id: string; passed: boolean }>
}

const cases: Record<string, CaseDefinition> = {
  'OMH-093': { fixture: 'business-contact-merge', file: 'src/modules/customer_merge/commands/merge-contacts.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'mergeContacts', requiredFlags: ['scopeValid', 'survivorSelected'] },
  'OMH-105': { fixture: 'business-deal-stage-transition', file: 'src/modules/deal_stages/commands/change-stage.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'changeDealStage', requiredFlags: ['transitionAllowed', 'requiredFieldsPresent'] },
  'OMH-107': { fixture: 'business-quote-discount-approval', file: 'src/modules/quote_approval/commands/request-discount.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'requestQuoteDiscount', requiredFlags: ['approvalSatisfied', 'separationOfDuties'] },
  'OMH-115': { fixture: 'ui-deal-board-accessibility', file: 'src/modules/deal_accessibility/backend/board/page.tsx', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'moveDealAccessibly', handler: 'handleDealBoardAction', requiredFlags: ['accessGranted', 'keyboardEquivalent'] },
  'OMH-122': { fixture: 'business-stock-reservation', file: 'src/modules/stock_reservations/commands/reserve-stock.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'reserveStock', requiredFlags: ['stockAvailable', 'reservationKeyPresent'] },
  'OMH-128': { fixture: 'async-bulk-price-update', file: 'src/modules/bulk_pricing/commands/update-prices.ts', family: 'async-operation', validator: 'oracle.business.async-operation', seam: 'updatePrices' },
  'OMH-130': { fixture: 'ui-public-lead-capture', file: 'src/modules/demo_requests/frontend/request-demo.tsx', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'submitDemoRequest', handler: 'handleDemoRequest', requiredFlags: ['scopeDerived', 'consentAccepted'] },
  'OMH-133': { fixture: 'business-portal-quote-approval', file: 'src/modules/portal_quote_approval/commands/approve-quote.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'approvePortalQuote', requiredFlags: ['portalScoped', 'latestVersion'] },
  'OMH-137': { fixture: 'ui-resumable-setup-wizard', file: 'src/modules/setup_wizard/backend/setup/page.tsx', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'advanceSetupWizard', handler: 'handleSetupWizardAction', requiredFlags: ['draftPersisted', 'transitionAllowed'] },
  'OMH-140': { fixture: 'workflow-invoice-dunning', file: 'src/modules/invoice_dunning/workflows/run-dunning.ts', family: 'async-operation', validator: 'oracle.business.async-operation', seam: 'runInvoiceDunning' },
  'OMH-144': { fixture: 'ai-quote-mutation', file: 'src/modules/quote_assistant/ai-tools.ts', family: 'ai-safe-agent', validator: 'oracle.business.ai-safe-agent', seam: 'saveQuoteDraftWithApproval', mode: 'mutation' },
  'OMH-146': { fixture: 'ai-sales-orchestrator', file: 'src/modules/sales_orchestrator/ai-agents.ts', family: 'ai-safe-agent', validator: 'oracle.business.ai-safe-agent', seam: 'coordinateSalesQuestion', mode: 'delegate' },
  'OMH-149': { fixture: 'integration-smtp-email', file: 'src/modules/smtp_email/lib/client.ts', family: 'provider-adapter', validator: 'oracle.business.provider-adapter', seam: 'sendTransactionalEmail' },
  'OMH-150': { fixture: 'integration-payment-idempotency', file: 'src/modules/card_payments/lib/adapter.ts', family: 'provider-adapter', validator: 'oracle.business.provider-adapter', seam: 'createCardPayment' },
  'OMH-151': { fixture: 'integration-carrier-booking', file: 'src/modules/carrier_shipping/lib/adapter.ts', family: 'provider-adapter', validator: 'oracle.business.provider-adapter', seam: 'bookCarrierShipment' },
  'OMH-153': { fixture: 'integration-erp-sync', file: 'src/modules/erp_sync/data-sync.ts', family: 'data-flow', validator: 'oracle.business.data-flow', seam: 'synchronizeErpPage' },
  'OMH-156': { fixture: 'data-product-import-export', file: 'src/modules/product_transfer/lib/flow.ts', family: 'data-flow', validator: 'oracle.business.data-flow', seam: 'transferProductRows' },
  'OMH-165': { fixture: 'testing-portal-quote-approval', file: 'tests/e2e/portal-quote-approval.spec.ts', family: 'test-authoring-mutation', validator: 'oracle.business.test-authoring', seam: 'runPortalQuoteApprovalScenario' },
  'OMH-171': { fixture: 'regression-missing-scope', file: 'src/modules/harness_fixture/api/scope/route.ts', family: 'regression', validator: 'oracle.regression.fail-closed' },
  'OMH-172': { fixture: 'regression-null-roundtrip', file: 'src/modules/harness_fixture/backend/edit/page.tsx', family: 'regression', validator: 'oracle.regression.null-roundtrip' },
  'OMH-181': { fixture: 'ui-order-risk-bulk-review', file: 'src/modules/order_risk/widgets/orders-table.tsx', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'reviewOrderRisk', handler: 'handleOrderRiskReview', requiredFlags: ['authorized', 'versionCurrent'] },
}

const fixtureIndex = JSON.parse(fs.readFileSync(fixtureIndexPath, 'utf8')) as {
  fixtures: Record<string, { seededArtifacts: string[]; precondition: string }>
}
const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8')) as {
  fixtures: Record<string, Record<string, string>>
}

function correctedSource(caseId: string, definition: CaseDefinition): string {
  const flags = JSON.stringify(definition.requiredFlags ?? [])
  if (definition.family === 'business-command') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  for (const flag of ${flags}) if (!input[flag]) throw new Error('business invariant failed')
  const existing = await effects.reserveIdempotency(input.idempotencyKey)
  if (existing) return existing
  return effects.transaction(async () => {
    const result = await effects.apply(input)
    await effects.record({ idempotencyKey: input.idempotencyKey, result })
    return result
  })
}
`
  }
  if (definition.family === 'ui-business-surface') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  for (const flag of ${flags}) if (!input[flag]) throw new Error('UI business invariant failed')
  const result = await effects.execute(input)
  await effects.restoreFocus(input.focusTarget)
  await effects.announce(result.message)
  return result
}

export async function ${definition.handler}(input: any, effects: any) {
  return ${definition.seam}(input, effects)
}
`
  }
  if (definition.family === 'async-operation') {
    return `
export async function ${definition.seam}(items: any[], effects: any) {
  let completed = 0
  for (const item of items) {
    if (await effects.isCancelled()) break
    if (await effects.shouldSkip(item)) {
      completed += 1
      continue
    }
    const undo = await effects.applyChunk([item])
    await effects.registerUndo(undo)
    completed += 1
    await effects.reportProgress({ completed, total: items.length })
  }
}
`
  }
  if (definition.family === 'ai-safe-agent' && definition.mode === 'mutation') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  if (!await effects.authorize(input)) throw new Error('not authorized')
  const prepared = await effects.prepareMutation(input)
  if (!prepared.approved) return { status: 'pending' }
  return effects.execute(prepared.input)
}
`
  }
  if (definition.family === 'ai-safe-agent') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  if (!await effects.authorize(input)) throw new Error('not authorized')
  return effects.delegate(input, { authority: 'read-only', allowedTools: input.allowedTools })
}
`
  }
  if (definition.family === 'provider-adapter') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  const existing = await effects.findExisting(input.idempotencyKey)
  if (existing) return existing
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    try {
      const response = await effects.request(input)
      const reconciled = await effects.reconcile(response)
      return effects.redact(reconciled)
    } catch {
      if (attempt + 1 === input.maxAttempts) throw new Error('provider request failed')
    }
  }
  throw new Error('provider request failed')
}
`
  }
  if (definition.family === 'data-flow') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  const page = await effects.fetchPage(input.cursor)
  const errors: unknown[] = []
  for (const row of page.items) {
    const sanitized = effects.sanitize(row)
    try { await effects.apply(sanitized) } catch (error) { errors.push(error) }
  }
  await effects.commitCursor(page.nextCursor)
  return { errors }
}
`
  }
  if (definition.family === 'test-authoring-mutation') {
    return `
export async function ${definition.seam}(harness: any) {
  let fixture: any
  try {
    fixture = await harness.createFixture()
    await harness.open(fixture)
    await harness.approve(fixture)
    await harness.expectConflict(fixture)
    await harness.verifyBackend(fixture)
  } finally {
    if (fixture) await harness.cleanup(fixture)
  }
}
`
  }
  if (caseId === 'OMH-171') {
    return `
export async function listRecords(scope: any, store: any) {
  if (!scope.tenantId || !scope.organizationId) throw new Error('complete scope is required')
  return store.find({ tenant_id: scope.tenantId, organization_id: scope.organizationId })
}
`
  }
  return `
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'

export function toInitialValues(record: { note: string | null }) { return { note: record.note } }
export function toUpdatePayload(values: { note: string | null }) { return { note: values.note === '' ? null : values.note } }
export function EditFixture({ record }: { record: { note: string | null } }) {
  return <CrudForm initialValues={toInitialValues(record)} fields={[]} onSubmit={async (values: { note: string | null }) => toUpdatePayload(values)} />
}
`
}

function writeFile(root: string, relative: string, source: string): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function stageTarget(caseId: string, corrected = false): string {
  const definition = cases[caseId]
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-business-oracles-')))
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(typescriptRoot, path.join(root, 'node_modules', 'typescript'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"business-oracle-target","private":true}\n')
  for (const [relative, source] of Object.entries(seeds.fixtures[definition.fixture] ?? {})) writeFile(root, relative, source)
  if (corrected) writeFile(root, definition.file, correctedSource(caseId, definition))
  return root
}

function installFakeYarn(root: string): string {
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin)
  const executable = path.join(bin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  if (process.platform === 'win32') {
    fs.writeFileSync(executable, '@echo off\r\nexit /b 0\r\n')
  } else {
    fs.writeFileSync(executable, '#!/usr/bin/env node\nprocess.exit(0)\n')
    fs.chmodSync(executable, 0o755)
  }
  return bin
}

function runOracle(oracle: string, root: string, caseId: string, phase: 'before' | 'after', env = process.env) {
  const result = spawnSync(process.execPath, [oracle, '--root', root, '--case', caseId, '--phase', phase, '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  })
  let parsed: OracleResult | undefined
  try { parsed = JSON.parse(result.stdout) as OracleResult } catch { /* assertions report raw output */ }
  return { ...result, parsed }
}

test('the 21 business writable cases have aligned controlled fixtures', () => {
  assert.equal(Object.keys(cases).length, 21)
  for (const [caseId, definition] of Object.entries(cases)) {
    const fixture = fixtureIndex.fixtures[definition.fixture]
    const seed = seeds.fixtures[definition.fixture]
    assert.ok(fixture, `${caseId}: fixture ${definition.fixture} is not registered`)
    assert.ok(seed, `${caseId}: fixture ${definition.fixture} has no controlled seed`)
    assert.deepEqual([...fixture.seededArtifacts].sort(), Object.keys(seed).sort(), `${caseId}: declared and seeded artifacts differ`)
    assert.equal(fixture.precondition, `${definition.validator} must fail`, `${caseId}: wrong trusted validator precondition`)
    assert.equal(typeof seed[definition.file], 'string', `${caseId}: behavior target is not seeded`)
  }
})

test('controlled seeds fail and corrected production seams pass both trusted oracles', { skip: process.platform === 'win32' }, () => {
  for (const [caseId] of Object.entries(cases)) {
    const seededRoot = stageTarget(caseId)
    try {
      for (const oracle of [astOracle, behaviorOracle]) {
        const before = runOracle(oracle, seededRoot, caseId, 'before')
        assert.equal(before.status, 1, `${caseId} seed unexpectedly passed ${path.basename(oracle)}\n${before.stdout}\n${before.stderr}`)
        assert.equal(before.parsed?.passed, false)
        assert.ok(before.parsed?.checks.some((check) => !check.passed), `${caseId}: seed produced no failed semantic check`)
      }
    } finally {
      fs.rmSync(seededRoot, { recursive: true, force: true })
    }

    const correctedRoot = stageTarget(caseId, true)
    const fakeBin = installFakeYarn(correctedRoot)
    const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` }
    try {
      for (const oracle of [astOracle, behaviorOracle]) {
        const after = runOracle(oracle, correctedRoot, caseId, 'after', env)
        assert.equal(after.status, 0, `${caseId} correction failed ${path.basename(oracle)}\n${after.stdout}\n${after.stderr}`)
        assert.equal(after.parsed?.passed, true)
        assert.ok(after.parsed?.checks.every((check) => check.passed), `${caseId}: correction left a semantic check failing`)
      }
    } finally {
      fs.rmSync(correctedRoot, { recursive: true, force: true })
    }
  }
})

test('business AST checks cannot be satisfied by a decoy export', () => {
  const root = stageTarget('OMH-093')
  writeFile(root, cases['OMH-093'].file, `
export async function mergeContacts() { throw new Error('not implemented') }
export async function decoy(input: any, effects: any) {
  await effects.reserveIdempotency(input.idempotencyKey)
  return effects.transaction(async () => {
    const result = await effects.apply(input)
    await effects.record({ idempotencyKey: input.idempotencyKey, result })
    return result
  })
}
`)
  try {
    const result = runOracle(astOracle, root, 'OMH-093', 'before')
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.command-seam')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('business behavior probes reject imports without executing target-controlled code', { skip: process.platform === 'win32' }, () => {
  const sentinel = path.join(os.tmpdir(), `om-business-oracle-sentinel-${process.pid}-${Date.now()}`)
  const root = stageTarget('OMH-093')
  writeFile(root, cases['OMH-093'].file, `
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(sentinel)}, 'unsafe')
export async function mergeContacts() {}
`)
  try {
    const result = runOracle(behaviorOracle, root, 'OMH-093', 'after')
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.parsed?.failures.join(' ') ?? '', /must not execute imports/)
    assert.equal(fs.existsSync(sentinel), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(sentinel, { force: true })
  }
})
