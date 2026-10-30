import type { Json } from '../types'
import type { EvalReport, EvalReportCase, EvalReportResult, EvalReportTrial } from './reportSchema'

/**
 * JUnit XML rendering of an eval report (eval reports spec §a).
 *
 * One `<testsuite>` per suite run, one `<testcase>` per case × trial.
 * `failed` → `<failure>`, `error` → `<error>`, `skipped`/unfinished → `<skipped>`.
 * Evidence travels in CDATA; a flaky case carries a `flaky` property on each
 * of its test cases and a `FLAKY` line in `<system-out>`.
 */

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '')
}

export function escapeXmlText(value: string): string {
  return stripInvalidXmlChars(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

export function wrapCdata(value: string): string {
  return `<![CDATA[${stripInvalidXmlChars(value).split(']]>').join(']]]]><![CDATA[>')}]]>`
}

function attributes(entries: Array<[string, string | number | null | undefined]>): string {
  return entries
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(String(value))}"`)
    .join('')
}

function formatSeconds(latencyMs: number | null): string {
  return ((latencyMs ?? 0) / 1000).toFixed(3)
}

function stringifyJson(value: Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function testcaseName(entry: EvalReportCase, trial: EvalReportTrial, multiTrial: boolean): string {
  const base = entry.name ? `${entry.key} (${entry.name})` : entry.key
  return multiTrial ? `${base} [trial ${trial.trialIndex}]` : base
}

function describeResult(result: EvalReportResult): string {
  const lines = [
    `Assertion: ${result.assertionKey}`,
    `Scorer: ${result.scorerKey}`,
    `Type: ${result.type}`,
    `Severity: ${result.severity}`,
  ]
  if (result.score !== null) lines.push(`Score: ${result.score}`)
  if (result.judgeFeedback) lines.push(`Judge feedback: ${result.judgeFeedback}`)
  if (result.evidence !== null) lines.push('Evidence:', stringifyJson(result.evidence))
  return lines.join('\n')
}

function failedResults(trial: EvalReportTrial): EvalReportResult[] {
  return trial.results.filter((result) => result.passed === false)
}

function renderOutcome(trial: EvalReportTrial, indent: string): string[] {
  const failures = failedResults(trial)
  if (trial.status === 'failed') {
    const keys = failures.map((result) => result.assertionKey)
    const message = keys.length ? `Failed assertions: ${keys.join(', ')}` : 'Case failed'
    const body = [trial.error, ...failures.map(describeResult)].filter((part): part is string => Boolean(part))
    return [
      `${indent}<failure${attributes([['message', message], ['type', 'assertion']])}>${body.length ? wrapCdata(body.join('\n\n')) : ''}</failure>`,
    ]
  }
  if (trial.status === 'error') {
    const message = trial.error ?? 'Case errored'
    const body = [trial.error, ...failures.map(describeResult)].filter((part): part is string => Boolean(part))
    return [
      `${indent}<error${attributes([['message', message.split('\n')[0]], ['type', 'error']])}>${body.length ? wrapCdata(body.join('\n\n')) : ''}</error>`,
    ]
  }
  if (trial.status === 'skipped') {
    const reasons = trial.results
      .map((result) => result.skipReason)
      .filter((reason): reason is string => Boolean(reason))
    return [`${indent}<skipped${attributes([['message', reasons.length ? reasons.join(', ') : 'skipped']])}/>`]
  }
  if (trial.status === 'pending' || trial.status === 'running') {
    return [`${indent}<skipped${attributes([['message', `not finished (${trial.status})`]])}/>`]
  }
  return []
}

function systemOut(entry: EvalReportCase, trial: EvalReportTrial): string {
  const lines = [
    `Case: ${entry.key}`,
    `Case id: ${entry.id}`,
    `Source: ${entry.source}`,
    `Trial: ${trial.trialIndex}`,
    `Status: ${trial.status}`,
    `Case run: ${trial.caseRunId}`,
    `Baseline status: ${entry.baselineStatus}`,
  ]
  if (trial.score !== null) lines.push(`Score: ${trial.score}`)
  if (trial.latencyMs !== null) lines.push(`Latency ms: ${trial.latencyMs}`)
  if (trial.costMinor !== null) lines.push(`Cost minor: ${trial.costMinor}`)
  if (trial.agentRunId) lines.push(`Agent run: ${trial.agentRunId}`)
  if (trial.tracePath) lines.push(`Trace: ${trial.tracePath}`)
  if (entry.flaky) lines.push('FLAKY: verdicts differ across trials of this case')
  if (entry.input !== undefined) lines.push('Input:', stringifyJson(entry.input))
  if (entry.expected !== undefined && entry.expected !== null) lines.push('Expected:', stringifyJson(entry.expected))
  if (trial.output !== undefined) lines.push('Output:', stringifyJson(trial.output))
  return lines.join('\n')
}

function renderTestcase(entry: EvalReportCase, trial: EvalReportTrial, report: EvalReport): string[] {
  const multiTrial = report.suiteRun.repeatCount > 1
  const indent = '      '
  const lines = [
    `    <testcase${attributes([
      ['name', testcaseName(entry, trial, multiTrial)],
      ['classname', `${report.suiteRun.agentId}.${entry.key}`],
      ['time', formatSeconds(trial.latencyMs)],
    ])}>`,
  ]
  if (entry.flaky) {
    lines.push(`${indent}<properties>`, `${indent}  <property name="flaky" value="true"/>`, `${indent}</properties>`)
  }
  lines.push(...renderOutcome(trial, indent))
  lines.push(`${indent}<system-out>${wrapCdata(systemOut(entry, trial))}</system-out>`)
  lines.push('    </testcase>')
  return lines
}

type TestcaseCounts = { tests: number; failures: number; errors: number; skipped: number; timeMs: number }

function countTestcases(report: EvalReport): TestcaseCounts {
  const counts: TestcaseCounts = { tests: 0, failures: 0, errors: 0, skipped: 0, timeMs: 0 }
  for (const entry of report.cases) {
    for (const trial of entry.trials) {
      counts.tests += 1
      counts.timeMs += trial.latencyMs ?? 0
      if (trial.status === 'failed') counts.failures += 1
      else if (trial.status === 'error') counts.errors += 1
      else if (trial.status !== 'passed') counts.skipped += 1
    }
  }
  return counts
}

function suiteProperties(report: EvalReport): Array<[string, string | number | null]> {
  return [
    ['schema', `${report.schema}@${report.schemaVersion}`],
    ['suiteRunId', report.suiteRun.id],
    ['agentId', report.suiteRun.agentId],
    ['status', report.status],
    ['trigger', report.suiteRun.trigger],
    ['outcome', report.suiteRun.outcome ?? 'not_evaluated'],
    ['passScore', report.suiteRun.passScore],
    ['repeatCount', report.suiteRun.repeatCount],
    ['judgeMayGate', String(report.suiteRun.judgeMayGate)],
    ['releaseId', report.suiteRun.releaseId],
    ['evalSetVersion', report.evalSet.version],
    ['evalSetLabel', report.evalSet.label],
    ['manifestHash', report.evalSet.manifestHash],
    ['baselineSuiteRunId', report.baseline.suiteRunId],
    ['flakyCases', report.totals.flakyCases],
    ['models', report.environment.models.join(',')],
    ['toolMode', report.environment.toolMode],
    ['modelMode', report.environment.modelMode],
    ['gitSha', report.environment.gitSha],
    ['cliVersion', report.environment.cliVersion],
  ]
}

function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

function suiteSystemOut(report: EvalReport): string {
  const lines = [`Gate verdict: ${(report.suiteRun.outcome ?? 'not_evaluated').toUpperCase()}`]
  if (report.regressions.length) lines.push(`Regressions: ${report.regressions.join(', ')}`)
  for (const warning of report.baseline.warnings) lines.push(`Baseline warning: ${warning}`)
  const flakyKeys = report.cases.filter((entry) => entry.flaky).map((entry) => entry.key)
  if (flakyKeys.length) lines.push(`Flaky cases: ${flakyKeys.join(', ')}`)
  for (const assertion of report.assertions) {
    const flags = [assertion.regressed ? 'regressed' : null, assertion.flaky ? 'flaky' : null].filter(Boolean)
    lines.push(
      `Assertion ${assertion.key}: pass rate ${formatRate(assertion.passRate)}, baseline ${formatRate(assertion.baselinePassRate)}${flags.length ? ` [${flags.join(', ')}]` : ''}`,
    )
  }
  return lines.join('\n')
}

export function renderEvalReportJunit(report: EvalReport): string {
  const counts = countTestcases(report)
  const suiteName = `agent-eval:${report.suiteRun.agentId}`
  const countAttributes: Array<[string, string | number]> = [
    ['tests', counts.tests],
    ['failures', counts.failures],
    ['errors', counts.errors],
    ['skipped', counts.skipped],
    ['time', formatSeconds(counts.timeMs)],
  ]
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites${attributes([['name', suiteName], ...countAttributes])}>`,
    `  <testsuite${attributes([
      ['name', suiteName],
      ['id', report.suiteRun.id],
      ...countAttributes,
      ['timestamp', report.suiteRun.startedAt],
    ])}>`,
    '    <properties>',
    ...suiteProperties(report)
      .filter((entry): entry is [string, string | number] => entry[1] !== null)
      .map(([name, value]) => `      <property${attributes([['name', name], ['value', value]])}/>`),
    '    </properties>',
  ]
  for (const entry of report.cases) {
    for (const trial of entry.trials) lines.push(...renderTestcase(entry, trial, report))
  }
  lines.push(`    <system-out>${wrapCdata(suiteSystemOut(report))}</system-out>`, '  </testsuite>', '</testsuites>')
  return `${lines.join('\n')}\n`
}
