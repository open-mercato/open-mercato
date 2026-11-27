import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../../agentic/', import.meta.url)
type HarnessCase = {
  id: string
  evaluationKind: string
  owner: { kind: string; path: string }
  expectedRouter: { required: string[] }
  requiredSkills: string[]
  context: { required: string[] }
  requiredDecisions: string[]
  relatedCases: string[]
  forbiddenPatterns: string[]
}

const read = (relative: string): string => fs.readFileSync(new URL(relative, root), 'utf8')

test('new monetary fields route to the Money contract through one owner', () => {
  const cases: HarnessCase[] = JSON.parse(read('shared/ai/harness/cases.json'))
  const entry = cases.find((candidate) => candidate.id === 'OMH-256')
  assert.ok(entry, 'a new monetary field requires its own routing regression case')
  assert.equal(entry.evaluationKind, 'routing')
  assert.equal(entry.owner.kind, 'skill')
  assert.equal(entry.owner.path, '.ai/skills/om-data-model-design/references/schema-design.md')
  assert.deepEqual(entry.expectedRouter.required, ['module-data'])
  assert.deepEqual(entry.requiredSkills, ['om-data-model-design'])
  for (const required of ['AGENTS.md', '.ai/guides/contracts.md', '.ai/skills/om-data-model-design/SKILL.md', entry.owner.path]) {
    assert.ok(entry.context.required.includes(required), `OMH-256 must require ${required}`)
  }
  assert.deepEqual(entry.requiredDecisions, [
    'money-value-object', 'money-columns-embeddable', 'scoped-resolve-currency',
    'explicit-money-rounding', 'no-new-number-or-exact-money-field',
  ])
  assert.deepEqual(entry.relatedCases, ['OMH-009', 'OMH-114'])
  const forbidden = entry.forbiddenPatterns.map((pattern) => new RegExp(pattern, 'i'))
  for (const unsafe of [
    'totalPrice!: number', 'totalPriceExact?: string', "@Property({ type: 'float' })",
    'parseFloat(input.totalPrice)', 'patch node_modules/@open-mercato/shared',
  ]) assert.ok(forbidden.some((pattern) => pattern.test(unsafe)), `must reject unsafe advice: ${unsafe}`)
  const safe = "@Embedded(() => MoneyColumns, { prefix: 'total_price_' }) totalPrice!: MoneyColumns; no new number or <field>Exact money field"
  assert.ok(forbidden.every((pattern) => !pattern.test(safe)), 'must accept the Money contract answer')

  const owner = read('shared/ai/skills/om-data-model-design/references/schema-design.md')
  for (const required of [
    '## Money Contract', '@open-mercato/shared/lib/money', '@open-mercato/shared/lib/db/moneyColumns',
    '`MoneyColumns`', '@Embedded(() => MoneyColumns', '`moneyToColumns`', '`moneyFromColumns`',
    'Entities never hold `Money`', '`<field>Exact`', 'resolveCurrency(container, { code, tenantId, organizationId })',
    '`CurrencyNotResolvedError`', '`CurrencyMismatchError`', '{ decimalPlaces, mode }', '`allocateMoney`',
    '`moneyInputSchema`', 'resolveMoney(container, scope, input)', 'fitsCurrencyPrecision(money)', '`snapshotMoney`', '`restoreMoney`',
  ]) assert.ok(owner.includes(required), `Money contract owner must state ${required}`)
  assert.match(owner, /only touches existing/)

  const pointer = /Money Contract[^\n]*references\/schema-design\.md|references\/schema-design\.md[^\n]*Money Contract/
  assert.match(read('guides/contracts.md'), pointer)
  assert.match(read('guides/contracts.md'), /`Money` \+ `MoneyColumns`/)
  assert.match(read('shared/ai/skills/om-data-model-design/SKILL.md'), /references\/schema-design\.md` for [^\n]*money/)
  assert.match(read('shared/ai/review-checklist.md'), pointer)
  assert.match(read('shared/AGENTS.md.template'), /\| `module-data` \| Entity\/link\/validator\/migration[^\n]*`om-data-model-design` \+ contracts \|/)

  const matrix: { routing: { required: { caseIds: string } }; writable: Array<{ caseId: string }> } = JSON.parse(
    read('shared/ai/harness/release-matrix.json'),
  )
  assert.equal(matrix.routing.required.caseIds, 'all')
  assert.ok(!matrix.writable.some((item) => item.caseId === entry.id))
})
