import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  RULE_EXACT_DECIMAL_KEY,
  RULE_NUMERIC_MONEY_COLUMN,
  checkDiff,
  classifyLine,
  findAllowlistEntry,
  globToRegExp,
  isInspectedPath,
  isMoneyLikeName,
  normalizeAllowlist,
  parseUnifiedDiff,
  run,
} from '../money-check-new-code.mjs'

function diffFor(filePath, hunks) {
  const body = hunks.map(({ header, lines }) => [header, ...lines].join('\n')).join('\n')
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'index 1111111..2222222 100644',
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    body,
    '',
  ].join('\n')
}

function addedFile(filePath, lines, startLine = 10) {
  return diffFor(filePath, [
    { header: `@@ -${startLine - 1},0 +${startLine},${lines.length} @@`, lines: lines.map((line) => `+${line}`) },
  ])
}

function rulesOf(findings) {
  return findings.map((finding) => `${finding.rule}:${finding.name}`)
}

const ENTITY = 'packages/core/src/modules/billing/data/entities.ts'
const MIGRATION = 'packages/core/src/modules/billing/migrations/Migration20261119000000_billing.ts'

test('parseUnifiedDiff tracks new-file line numbers and ignores removed and context lines', () => {
  const diff = diffFor(ENTITY, [
    {
      header: '@@ -5,3 +5,4 @@',
      lines: [' context line', '-removed line', '+added one', '+added two', ' trailing context'],
    },
    { header: '@@ -40,0 +41 @@', lines: ['+single added'] },
  ])
  const files = parseUnifiedDiff(diff)
  assert.equal(files.length, 1)
  assert.equal(files[0].path, ENTITY)
  assert.deepEqual(files[0].addedLines, [
    { line: 6, text: 'added one' },
    { line: 7, text: 'added two' },
    { line: 41, text: 'single added' },
  ])
})

test('parseUnifiedDiff treats ++ content lines inside a hunk as added lines, not headers', () => {
  const diff = diffFor('packages/x/src/a.ts', [{ header: '@@ -1,0 +1,1 @@', lines: ['++++ b/fake'] }])
  assert.deepEqual(parseUnifiedDiff(diff)[0].addedLines, [{ line: 1, text: '+++ b/fake' }])
})

test('parseUnifiedDiff skips deleted files', () => {
  const diff = [
    `diff --git a/${ENTITY} b/${ENTITY}`,
    'deleted file mode 100644',
    `--- a/${ENTITY}`,
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    "-  @Property({ name: 'total_amount', type: ExactDecimalType, columnType: 'numeric' })",
    '',
  ].join('\n')
  assert.deepEqual(parseUnifiedDiff(diff), [])
})

test('isMoneyLikeName recognises money-like snake_case and camelCase names', () => {
  for (const name of ['unit_price_net', 'line_total', 'shipping_cost', 'handling_fee', 'order_value', 'amount', 'totalGrossAmount', 'unitPrice', 'dealValue', 'grandTotalNet']) {
    assert.equal(isMoneyLikeName(name), true, name)
  }
  for (const name of ['latitude', 'tax_rate', 'value', 'quantity', 'total_quantity', 'discount_percent', 'currency_code', 'line_count']) {
    assert.equal(isMoneyLikeName(name), false, name)
  }
})

test('isInspectedPath skips tests, generated files, build output and the money implementation', () => {
  assert.equal(isInspectedPath(ENTITY), true)
  assert.equal(isInspectedPath('packages/core/src/modules/billing/migrations/001.sql'), true)
  assert.equal(isInspectedPath('packages/core/src/modules/billing/components/Form.tsx'), true)
  for (const skipped of [
    'packages/core/src/modules/billing/__tests__/entities.test.ts',
    'packages/core/src/modules/billing/lib/totals.test.ts',
    'packages/core/src/modules/billing/__integration__/TC-BILL-001.spec.ts',
    'apps/mercato/.mercato/generated/modules.generated.ts',
    'packages/core/dist/modules/billing/data/entities.ts',
    'node_modules/some-lib/index.ts',
    'packages/core/src/modules/billing/migrations/.snapshot-open-mercato.json',
    'packages/shared/src/lib/money/money.ts',
    'packages/shared/src/lib/db/moneyColumns.ts',
    'packages/shared/src/lib/decimal.ts',
    'packages/core/src/modules/billing/README.md',
  ]) {
    assert.equal(isInspectedPath(skipped), false, skipped)
  }
})

test('flags a new numeric amount column declared in an entity decorator line', () => {
  const diff = addedFile(ENTITY, [
    "  @Property({ name: 'total_amount', type: ExactDecimalType, columnType: 'numeric', default: '0' })",
    "  totalAmount: string = '0'",
    "  @Property({ name: 'shipping_fee', type: 'numeric', precision: 18, scale: 4 })",
    '  shippingFee!: string',
  ])
  const { findings } = checkDiff(diff)
  assert.deepEqual(rulesOf(findings), [`${RULE_NUMERIC_MONEY_COLUMN}:total_amount`, `${RULE_NUMERIC_MONEY_COLUMN}:shipping_fee`])
  assert.equal(findings[0].line, 10)
  assert.equal(findings[1].line, 12)
})

test('flags a decorator without name: using the property declared on the next added line', () => {
  const diff = addedFile(ENTITY, ["  @Property({ type: ExactDecimalType, columnType: 'numeric' })", '  unitPrice!: string'])
  assert.deepEqual(rulesOf(checkDiff(diff).findings), [`${RULE_NUMERIC_MONEY_COLUMN}:unitPrice`])
})

test('does not flag non-monetary numeric columns or money-like names without a numeric type', () => {
  const diff = addedFile(ENTITY, [
    "  @Property({ name: 'latitude', type: 'numeric', precision: 10, scale: 6, nullable: true })",
    "  @Property({ name: 'tax_rate', type: ExactDecimalType, columnType: 'numeric' })",
    "  @Property({ name: 'total_quantity', type: ExactDecimalType, columnType: 'numeric' })",
    "  @Property({ name: 'price_label', type: 'text' })",
    '  totalAmount: number',
    '  amountNet: string                // negative decimal string',
    "  totalNetAmount: z.string().describe('Exact decimal string of the net total'),",
  ])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('flags query-builder numeric money columns', () => {
  const diff = addedFile('packages/core/src/modules/billing/lib/schema.ts', [
    "  table.decimal('handling_fee', 18, 4)",
    "  .addColumn('order_total', 'numeric(18,4)')",
  ])
  assert.deepEqual(rulesOf(checkDiff(diff).findings), [
    `${RULE_NUMERIC_MONEY_COLUMN}:handling_fee`,
    `${RULE_NUMERIC_MONEY_COLUMN}:order_total`,
  ])
})

test('flags a new numeric money column in an SQL migration line', () => {
  const diff = addedFile(MIGRATION, [
    '    this.addSql(`alter table "billing_invoices" add column "line_total" numeric(18,4) not null default \'0\';`);',
  ])
  const { findings } = checkDiff(diff)
  assert.deepEqual(rulesOf(findings), [`${RULE_NUMERIC_MONEY_COLUMN}:line_total`])
})

test('flags every money-like numeric column of a create table statement and ignores the rest', () => {
  const diff = addedFile('packages/core/src/modules/billing/migrations/001_init.sql', [
    'create table "billing_lines" ("id" uuid not null, "quantity" numeric(18,4) not null, "unit_price_net" numeric(18,4) not null, "tax_rate" numeric(7,4) not null, "name" text null);',
    '  shipping_cost numeric(18,4) not null,',
  ])
  assert.deepEqual(rulesOf(checkDiff(diff).findings), [
    `${RULE_NUMERIC_MONEY_COLUMN}:unit_price_net`,
    `${RULE_NUMERIC_MONEY_COLUMN}:shipping_cost`,
  ])
})

test('flags a new <field>Exact key in a zod schema and a type', () => {
  const schemaDiff = addedFile('packages/core/src/modules/billing/data/validators.ts', [
    '  unitPriceExact: z.string().regex(decimalPattern).optional(),',
    "  'amountExact': z.string(),",
  ])
  const typeDiff = addedFile('packages/core/src/modules/billing/lib/types.ts', [
    '  totalExact?: string | null',
    '  readonly feeExact: string',
  ])
  assert.deepEqual(rulesOf(checkDiff(schemaDiff).findings), [
    `${RULE_EXACT_DECIMAL_KEY}:unitPriceExact`,
    `${RULE_EXACT_DECIMAL_KEY}:amountExact`,
  ])
  assert.deepEqual(rulesOf(checkDiff(typeDiff).findings), [
    `${RULE_EXACT_DECIMAL_KEY}:totalExact`,
    `${RULE_EXACT_DECIMAL_KEY}:feeExact`,
  ])
})

test('does not flag reads, calls or function-valued <field>Exact keys', () => {
  const diff = addedFile('packages/core/src/modules/billing/lib/totals.ts', [
    '  const net = line.unitPriceExact ?? fallback',
    '  return toExact(line.amountExact, currency)',
    '  doSomething({ ...line, amountExact: next })',
    '  getExact: (value: string) => normalize(value),',
    '  // amountExact: legacy contract',
  ])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('reads the property declared on the same line as its decorator', () => {
  const diff = addedFile(ENTITY, [
    "  @Property({ type: ExactDecimalType, columnType: 'numeric' }) unitCost!: string",
    '  shippingFee!: string',
    "  @Property({ type: 'numeric' }) @Index() taxRate!: string",
    '  totalPrice!: string',
  ])
  assert.deepEqual(rulesOf(checkDiff(diff).findings), [`${RULE_NUMERIC_MONEY_COLUMN}:unitCost`])
})

test('does not flag object-literal writes that map an existing <field>Exact value', () => {
  const diff = addedFile('packages/core/src/modules/payment_gateways/api/transactions/route.ts', [
    '    amountExact: toMoneyString(transaction.amount),',
    '    unitPriceExact: line.unitPriceExact ?? null,',
    "    totalExact: decimalToString(total),",
    '    feeExact,',
  ])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('flags class property and initialised type declarations of <field>Exact keys', () => {
  const diff = addedFile('packages/core/src/modules/billing/data/entities.ts', [
    '  unitPriceExact!: string',
    '  discountExact: string | null = null',
    '  rateExact: DecimalValue;',
    '  surchargeExact: nonNegativeDecimalStringSchema.optional(),',
  ])
  assert.deepEqual(rulesOf(checkDiff(diff).findings), [
    `${RULE_EXACT_DECIMAL_KEY}:unitPriceExact`,
    `${RULE_EXACT_DECIMAL_KEY}:discountExact`,
    `${RULE_EXACT_DECIMAL_KEY}:rateExact`,
    `${RULE_EXACT_DECIMAL_KEY}:surchargeExact`,
  ])
})

test('parseUnifiedDiff strips mnemonic diff prefixes so exclusions and allowlists still match', () => {
  const diff = [
    'diff --git c/packages/shared/src/lib/money/money.ts w/packages/shared/src/lib/money/money.ts',
    '--- c/packages/shared/src/lib/money/money.ts',
    '+++ w/packages/shared/src/lib/money/money.ts',
    '@@ -1,0 +1,1 @@',
    '+  totalExact?: string | null',
    '',
  ].join('\n')
  assert.equal(parseUnifiedDiff(diff)[0].path, 'packages/shared/src/lib/money/money.ts')
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('does not flag an @Embedded MoneyColumns field', () => {
  const diff = addedFile(ENTITY, ["  @Embedded(() => MoneyColumns, { prefix: 'price_' })", '  price!: MoneyColumns'])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('does not flag the column triple added by a MoneyColumns migration', () => {
  const diff = addedFile(MIGRATION, [
    '    this.addSql(`alter table "billing_invoices" add column "price_amount" numeric not null, add column "price_currency_code" text not null, add column "price_currency_decimal_places" int not null;`);',
  ])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('the MoneyColumns triple exemption needs all three columns and only covers <prefix>amount', () => {
  const partial = addedFile(MIGRATION, [
    '    this.addSql(`alter table "billing_invoices" add column "price_amount" numeric not null;`);',
    '    this.addSql(`alter table "billing_invoices" add column "price_currency_code" text not null;`);',
  ])
  assert.deepEqual(rulesOf(checkDiff(partial).findings), [`${RULE_NUMERIC_MONEY_COLUMN}:price_amount`])

  const mixed = addedFile(MIGRATION, [
    '    this.addSql(`alter table "billing_invoices" add column "price_amount" numeric not null;`);',
    '    this.addSql(`alter table "billing_invoices" add column "price_currency_code" text not null;`);',
    '    this.addSql(`alter table "billing_invoices" add column "price_currency_decimal_places" int not null;`);',
    '    this.addSql(`alter table "billing_invoices" add column "handling_fee" numeric not null;`);',
  ])
  assert.deepEqual(rulesOf(checkDiff(mixed).findings), [`${RULE_NUMERIC_MONEY_COLUMN}:handling_fee`])
})

test('does not flag removed lines or context lines', () => {
  const diff = diffFor(ENTITY, [
    {
      header: '@@ -10,3 +10,1 @@',
      lines: [
        "-  @Property({ name: 'total_amount', type: ExactDecimalType, columnType: 'numeric' })",
        '-  totalAmountExact?: string | null',
        "   @Property({ name: 'grand_total', type: 'numeric' })",
      ],
    },
  ])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('does not flag test files even when they declare money columns', () => {
  const diff = addedFile('packages/core/src/modules/billing/__tests__/entities.test.ts', [
    "  @Property({ name: 'total_amount', type: ExactDecimalType, columnType: 'numeric' })",
    '  totalAmountExact: z.string(),',
  ])
  assert.deepEqual(checkDiff(diff).findings, [])
})

test('allowlisted paths and patterns are counted but not reported', () => {
  const diff = [
    addedFile('packages/core/src/modules/sales/data/validators.ts', ['  surchargeAmountExact: z.string().optional(),']),
    addedFile(ENTITY, [
      "  @Property({ name: 'metric_value', type: 'numeric' })",
      "  @Property({ name: 'late_fee', type: 'numeric' })",
    ]),
  ].join('')
  const allowlist = normalizeAllowlist({
    description: 'test',
    entries: [
      { path: 'packages/core/src/modules/sales/**', reason: 'extends the existing sales <field>Exact contract' },
      { path: 'packages/core/src/modules/billing/data/', pattern: "'metric_value'", reason: 'non-monetary score' },
    ],
  })
  const { findings, allowlisted } = checkDiff(diff, { allowlist })
  assert.equal(allowlisted, 2)
  assert.deepEqual(rulesOf(findings), [`${RULE_NUMERIC_MONEY_COLUMN}:late_fee`])
})

test('globToRegExp and findAllowlistEntry support **, * and plain path prefixes', () => {
  assert.equal(globToRegExp('packages/*/src/**/validators.ts').test('packages/core/src/modules/sales/data/validators.ts'), true)
  assert.equal(globToRegExp('packages/*/src/**/validators.ts').test('packages/core/lib/validators.ts'), false)
  assert.equal(globToRegExp('**/entities.ts').test('entities.ts'), true)
  const entries = normalizeAllowlist({ entries: [{ path: 'packages/core/src/modules/sales', reason: 'prefix' }] })
  assert.ok(findAllowlistEntry({ path: 'packages/core/src/modules/sales/data/entities.ts', text: 'x' }, entries))
  assert.equal(findAllowlistEntry({ path: 'packages/core/src/modules/catalog/data/entities.ts', text: 'x' }, entries), null)
})

test('normalizeAllowlist rejects malformed allowlists', () => {
  assert.throws(() => normalizeAllowlist({ entries: {} }), /entries/)
  assert.throws(() => normalizeAllowlist({ entries: [{ reason: 'no path' }] }), /path/)
})

test('classifyLine ignores comment lines', () => {
  assert.deepEqual(classifyLine(ENTITY, "  // @Property({ name: 'total_amount', type: 'numeric' })"), [])
  assert.deepEqual(classifyLine(MIGRATION, '-- add column "line_total" numeric'), [])
})

test('the repository allowlist file is valid', () => {
  const root = path.resolve(import.meta.dirname, '..', '..')
  const parsed = JSON.parse(fs.readFileSync(path.join(root, '.ai', 'money-allowlist.json'), 'utf8'))
  assert.equal(typeof parsed.description, 'string')
  assert.doesNotThrow(() => normalizeAllowlist(parsed))
})

function runWithDiff(diffText, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-check-'))
  const diffPath = path.join(dir, 'change.diff')
  fs.writeFileSync(diffPath, diffText)
  let stdout = ''
  let stderr = ''
  const code = run(['--diff-file', diffPath, ...extraArgs], {
    root: dir,
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })
  fs.rmSync(dir, { recursive: true, force: true })
  return { code, stdout, stderr }
}

const FLAGGED_DIFF = addedFile(ENTITY, ["  @Property({ name: 'total_amount', type: ExactDecimalType, columnType: 'numeric' })"])
const CLEAN_DIFF = addedFile(ENTITY, ["  @Embedded(() => MoneyColumns, { prefix: 'price_' })"])

test('run is advisory: exit 0 with findings and a remediation hint', () => {
  const result = runWithDiff(FLAGGED_DIFF)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`${ENTITY.replace(/[.]/g, '\\.')}:10  numeric-money-column  @Property`))
  assert.match(result.stdout, /@open-mercato\/shared\/lib\/money/)
  assert.match(result.stdout, /MoneyColumns/)
  assert.match(result.stdout, /\.ai\/money-allowlist\.json/)
})

test('run --strict exits 1 with findings and 0 without', () => {
  assert.equal(runWithDiff(FLAGGED_DIFF, ['--strict']).code, 1)
  assert.equal(runWithDiff(CLEAN_DIFF, ['--strict']).code, 0)
})

test('run --json emits machine-readable findings', () => {
  const result = runWithDiff(FLAGGED_DIFF, ['--json'])
  assert.equal(result.code, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.totalFindings, 1)
  assert.deepEqual(
    { path: payload.findings[0].path, line: payload.findings[0].line, rule: payload.findings[0].rule, name: payload.findings[0].name },
    { path: ENTITY, line: 10, rule: RULE_NUMERIC_MONEY_COLUMN, name: 'total_amount' },
  )
})

test('run exits 2 on usage errors', () => {
  const sink = { stdout: () => {}, stderr: () => {} }
  assert.equal(run(['--unknown'], sink), 2)
  assert.equal(run(['--base'], sink), 2)
  assert.equal(run(['--diff-file', path.join(os.tmpdir(), 'does-not-exist-money.diff')], sink), 2)
  assert.equal(run(['--base', 'refs/heads/definitely-not-a-branch-money-check'], sink), 2)
})

const REPO_ENTITY = 'src/modules/foo/data/entities.ts'

function createTempRepo(initialBranch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-check-repo-'))
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commitFile = (relativePath, content, message) => {
    fs.mkdirSync(path.dirname(path.join(dir, relativePath)), { recursive: true })
    fs.writeFileSync(path.join(dir, relativePath), content)
    git('add', relativePath)
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet', '-b', initialBranch)
  git('config', 'user.name', 'Money Check Test')
  git('config', 'user.email', 'money-check@example.com')
  return { dir, git, commitFile }
}

function runInRepo(dir, extraArgs = []) {
  let stdout = ''
  let stderr = ''
  const code = run(extraArgs, {
    root: dir,
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })
  return { code, stdout, stderr }
}

const VIOLATING_ENTITY = [
  'export class Foo {',
  "  @Property({ name: 'total_amount', type: ExactDecimalType, columnType: 'numeric' })",
  '  totalAmount!: string',
  '}',
  '',
].join('\n')

test('the default base reaches the default branch, catching findings from earlier feature commits', () => {
  const repo = createTempRepo('main')
  try {
    repo.commitFile('README.md', 'baseline\n', 'baseline')
    repo.git('checkout', '--quiet', '-b', 'feature')
    repo.commitFile(REPO_ENTITY, VIOLATING_ENTITY, 'add foo entity')
    repo.commitFile('notes.txt', 'unrelated\n', 'unrelated change')

    const result = runInRepo(repo.dir, ['--json'])
    assert.equal(result.code, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.match(payload.source, /^main\.\.\.HEAD/)
    assert.deepEqual(
      payload.findings.map(({ path: filePath, line, rule, name }) => ({ path: filePath, line, rule, name })),
      [{ path: REPO_ENTITY, line: 2, rule: RULE_NUMERIC_MONEY_COLUMN, name: 'total_amount' }],
    )

    const previousCommitOnly = JSON.parse(runInRepo(repo.dir, ['--json', '--base', 'HEAD~1']).stdout)
    assert.equal(previousCommitOnly.totalFindings, 0)

    const text = runInRepo(repo.dir)
    assert.match(text.stdout, /^\[money-check-new-code\] Added lines in main\.\.\.HEAD \+ working tree \(default base\)\n/)
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true })
  }
})

test('the default base prefers the remote default branch advertised by refs/remotes/origin/HEAD', () => {
  const repo = createTempRepo('feature')
  try {
    const baseline = repo.commitFile('README.md', 'baseline\n', 'baseline')
    repo.git('update-ref', 'refs/remotes/origin/trunk', baseline)
    repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    repo.commitFile(REPO_ENTITY, VIOLATING_ENTITY, 'add foo entity')
    repo.git('branch', 'main')
    repo.commitFile('notes.txt', 'unrelated\n', 'unrelated change')

    const result = runInRepo(repo.dir)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /^\[money-check-new-code\] Added lines in origin\/trunk\.\.\.HEAD \+ working tree \(default base from refs\/remotes\/origin\/HEAD\)\n/)
    assert.match(result.stdout, new RegExp(`${REPO_ENTITY.replace(/[.]/g, '\\.')}:2  ${RULE_NUMERIC_MONEY_COLUMN}`))

    const strict = runInRepo(repo.dir, ['--strict', '--json'])
    assert.equal(strict.code, 1)
    assert.equal(JSON.parse(strict.stdout).totalFindings, 1)
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true })
  }
})
