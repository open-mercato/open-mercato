import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'

const [receiptPath, queuePath] = process.argv.slice(2)
assert(receiptPath && queuePath, '[internal] Expected receipt and queue Jest JSON reports')

function readAssertions(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  assert(report.success && report.numPassedTests > 0, `[internal] Durability suite did not pass: ${reportPath}`)
  assert.equal(report.numPendingTests, 0, `[internal] Durability suite skipped tests: ${reportPath}`)
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults)
  assert.equal(assertions.length, report.numTotalTests, '[internal] Incomplete durability test report')
  assert(assertions.every((result) => result.status === 'passed'), '[internal] Durability assertions must all execute and pass')
  return assertions
}

const receiptAssertions = readAssertions(receiptPath)
const queueAssertions = readAssertions(queuePath)
const groups = [
  ...[1, 8].map((poolSize) => {
    const assertions = receiptAssertions.filter((result) => result.fullName.startsWith(`inbound receipt PostgreSQL transactions with pool size ${poolSize} `))
    assert(assertions.some((result) => result.fullName.includes('recovers twenty timed-out Redis deliveries')), `[internal] Redis receipt recovery did not execute with pool size ${poolSize}`)
    return { label: `PostgreSQL receipts, pool ${poolSize} + Redis recovery`, assertions }
  }),
  ...['local', 'async'].map((strategy) => {
    const assertions = queueAssertions.filter((result) => result.fullName.startsWith(`keyed ${strategy} publication `))
    assert(assertions.some((result) => result.fullName.includes('deduplicates concurrent producers and an active handler')), `[internal] ${strategy} active-job deduplication did not execute`)
    assert(assertions.some((result) => result.fullName.includes('deduplicates the late write against retry')), `[internal] ${strategy} late-write recovery did not execute`)
    return { label: `Queue publication, ${strategy}`, assertions }
  }),
]

const summary = [
  '### Webhook durability service regressions',
  '',
  '| Required coverage | Executed and passed |',
  '| --- | ---: |',
  ...groups.map(({ label, assertions }) => `| ${label} | ${assertions.length} |`),
  '',
  `All ${receiptAssertions.length + queueAssertions.length} tests executed and passed; none skipped.`,
  '',
].join('\n')
process.stdout.write(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
