import type { Json } from '../types'
import type { EvalReport, EvalReportAssertion, EvalReportCase, EvalReportResult, EvalReportTrial } from './reportSchema'

/**
 * Markdown rendering of an eval report (eval reports spec §a). Pure and
 * deterministic: the output depends only on the report, in the report's order.
 * Structural labels are English on purpose — the file is a CI artifact.
 */

const JUDGE_ASSERTION_TYPE = 'llm_judge'
const EMPTY_CELL = '—'

export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, '<br>')
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY_CELL
  return escapeMarkdownCell(String(value))
}

function inlineText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ')
}

function formatNumber(value: number | null, digits = 3): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return String(Number(value.toFixed(digits)))
}

function formatRate(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return `${(value * 100).toFixed(1)}%`
}

function formatDelta(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  const points = value * 100
  const sign = points > 0 ? '+' : points < 0 ? '-' : '±'
  return `${sign}${Math.abs(points).toFixed(1)} pp`
}

function formatLatency(value: number | null): string | null {
  return value === null ? null : `${formatNumber(value, 0)} ms`
}

function formatCost(costMinor: number | null, currency: string | null): string | null {
  if (costMinor === null) return null
  return currency ? `${costMinor} ${currency} (minor units)` : `${costMinor} (minor units)`
}

function gateVerdict(report: EvalReport): string {
  const outcome = report.suiteRun.outcome
  if (outcome === 'passed') return 'PASSED'
  if (outcome === 'failed') return 'FAILED'
  if (outcome === 'advisory') return 'ADVISORY'
  return 'NOT EVALUATED'
}

function codeFence(content: string, language: string): string[] {
  const longestRun = (content.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return [`${fence}${language}`, ...content.split(/\r\n|\r|\n/), fence]
}

function jsonBlock(value: Json): string[] {
  if (typeof value === 'string') return codeFence(value, 'text')
  return codeFence(JSON.stringify(value, null, 2), 'json')
}

function renderHeader(report: EvalReport): string[] {
  const { suiteRun, evalSet, baseline } = report
  const rows: Array<[string, string | number | null]> = [
    ['Suite run', suiteRun.id],
    ['Agent', suiteRun.agentId],
    ['Report status', report.status],
    ['Trigger', suiteRun.trigger],
    ['Eval set version', evalSet.version],
    ['Eval set label', evalSet.label],
    ['Pin', evalSet.pinKind],
    ['Manifest hash', evalSet.manifestHash],
    ['Eval set source', evalSet.source],
    ['Baseline run', baseline.suiteRunId],
    ['Release', suiteRun.releaseId],
    ['Repeat count', suiteRun.repeatCount],
    ['Started', suiteRun.startedAt],
    ['Finished', suiteRun.finishedAt],
    ['Generated', report.generatedAt],
  ]
  return [
    `# Eval report: ${inlineText(suiteRun.agentId)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${label} | ${cell(value)} |`),
  ]
}

function renderGate(report: EvalReport): string[] {
  const lines = [
    '## Gate',
    '',
    `**Verdict: ${gateVerdict(report)}**`,
    '',
    `- Pass score: ${formatNumber(report.suiteRun.passScore, 4) ?? EMPTY_CELL}`,
    `- Score variance: ${formatNumber(report.suiteRun.scoreVariance, 4) ?? EMPTY_CELL}`,
    `- Judge may gate: ${report.suiteRun.judgeMayGate ? 'yes' : 'no'}`,
  ]
  if (report.regressions.length) {
    lines.push('', '### Regressions', '')
    for (const regression of report.regressions) lines.push(`- ${inlineText(regression)}`)
  }
  return lines
}

function renderSummary(report: EvalReport): string[] {
  const { totals } = report
  return [
    '## Summary',
    '',
    '| Cases | Trials | Passed | Failed | Errored | Skipped | Flaky cases |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${totals.cases} | ${totals.trials} | ${totals.passed} | ${totals.failed} | ${totals.errored} | ${totals.skipped} | ${totals.flakyCases} |`,
    '',
    `- Cost: ${formatCost(totals.costMinor, totals.currency) ?? EMPTY_CELL}`,
    `- Latency p50 / p95 / max: ${formatLatency(totals.latencyMs.p50) ?? EMPTY_CELL} / ${formatLatency(totals.latencyMs.p95) ?? EMPTY_CELL} / ${formatLatency(totals.latencyMs.max) ?? EMPTY_CELL}`,
    `- Tokens in / out: ${totals.tokens.input ?? EMPTY_CELL} / ${totals.tokens.output ?? EMPTY_CELL}`,
  ]
}

function renderEnvironment(report: EvalReport): string[] {
  const { environment } = report
  const seed = environment.modelSettings.seed
  return [
    '## Environment',
    '',
    `- Models: ${environment.models.length ? environment.models.map(inlineText).join(', ') : EMPTY_CELL}`,
    `- Temperature: ${environment.modelSettings.temperature ?? EMPTY_CELL}`,
    `- Seed: ${seed ? `${seed.requested} (honored: ${seed.honored})` : EMPTY_CELL}`,
    `- Tool mode: ${environment.toolMode}`,
    `- Model mode: ${environment.modelMode}`,
    `- Git SHA: ${environment.gitSha ? inlineText(environment.gitSha) : EMPTY_CELL}`,
    `- CLI version: ${environment.cliVersion ? inlineText(environment.cliVersion) : EMPTY_CELL}`,
  ]
}

function renderBaseline(report: EvalReport): string[] {
  const { baseline } = report
  const sameDataset = baseline.sameDataset === null ? EMPTY_CELL : baseline.sameDataset ? 'yes' : 'no'
  const lines = [
    '## Baseline',
    '',
    `- Baseline run: ${baseline.suiteRunId ? inlineText(baseline.suiteRunId) : 'none'}`,
    `- Baseline manifest hash: ${baseline.manifestHash ? inlineText(baseline.manifestHash) : EMPTY_CELL}`,
    `- Same dataset: ${sameDataset}`,
  ]
  if (baseline.warnings.length) {
    lines.push('', '### Warnings', '')
    for (const warning of baseline.warnings) lines.push(`- ${inlineText(warning)}`)
  }
  return lines
}

function assertionFlags(assertion: EvalReportAssertion): string {
  const flags: string[] = []
  if (assertion.regressed) flags.push('regressed')
  if (assertion.flaky) flags.push('flaky')
  return flags.join(', ')
}

function assertionRow(assertion: EvalReportAssertion): string {
  return [
    cell(assertion.key),
    cell(assertion.scorerKey),
    cell(assertion.type),
    cell(assertion.severity),
    cell(formatRate(assertion.passRate)),
    cell(`${assertion.passed}/${assertion.failed}/${assertion.skipped}`),
    cell(formatRate(assertion.baselinePassRate)),
    cell(formatDelta(assertion.delta)),
    cell(assertionFlags(assertion)),
  ].join(' | ')
}

function renderAssertions(report: EvalReport): string[] {
  const lines = ['## Assertions', '']
  if (!report.assertions.length) return [...lines, '_No assertions._']
  lines.push(
    '| Assertion | Scorer | Type | Severity | Pass rate | Pass/Fail/Skip | Baseline | Delta | Flags |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...report.assertions.map((assertion) => `| ${assertionRow(assertion)} |`),
  )
  const judgeAssertions = report.assertions.filter((assertion) => assertion.type === JUDGE_ASSERTION_TYPE)
  if (judgeAssertions.length) {
    lines.push(
      '',
      '### Judge deltas',
      '',
      '| Assertion | Pass rate | Baseline | Delta |',
      '| --- | ---: | ---: | ---: |',
      ...judgeAssertions.map(
        (assertion) =>
          `| ${cell(assertion.key)} | ${cell(formatRate(assertion.passRate))} | ${cell(formatRate(assertion.baselinePassRate))} | ${cell(formatDelta(assertion.delta))} |`,
      ),
    )
  }
  return lines
}

function caseLabel(entry: EvalReportCase): string {
  return entry.name ? `${entry.key} (${entry.name})` : entry.key
}

function averageScore(trials: ReadonlyArray<EvalReportTrial>): number | null {
  const scores = trials.map((trial) => trial.score).filter((score): score is number => score !== null)
  if (!scores.length) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function maxLatency(trials: ReadonlyArray<EvalReportTrial>): number | null {
  const latencies = trials.map((trial) => trial.latencyMs).filter((latency): latency is number => latency !== null)
  return latencies.length ? Math.max(...latencies) : null
}

function renderCases(report: EvalReport): string[] {
  const lines = ['## Cases', '']
  if (!report.cases.length) return [...lines, '_No cases._']
  lines.push(
    '| Case | Source | Trials | Score | Max latency | Baseline | Flaky |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
  )
  for (const entry of report.cases) {
    const statuses = entry.trials.map((trial) => trial.status).join(', ')
    lines.push(
      `| ${[
        cell(caseLabel(entry)),
        cell(entry.source),
        cell(statuses),
        cell(formatNumber(averageScore(entry.trials))),
        cell(formatLatency(maxLatency(entry.trials))),
        cell(entry.baselineStatus),
        entry.flaky ? 'yes' : 'no',
      ].join(' | ')} |`,
    )
  }
  return lines
}

function isFailedResult(result: EvalReportResult): boolean {
  return result.passed === false
}

function isFailingTrial(trial: EvalReportTrial): boolean {
  return trial.status === 'failed' || trial.status === 'error' || trial.results.some(isFailedResult)
}

function renderFailedResult(result: EvalReportResult): string[] {
  const score = formatNumber(result.score)
  const lines = [
    `- \`${inlineText(result.assertionKey)}\` — scorer ${inlineText(result.scorerKey)}, type ${inlineText(result.type)}, severity ${inlineText(result.severity)}${score === null ? '' : `, score ${score}`}`,
  ]
  if (result.judgeFeedback) lines.push('', `  Judge feedback: ${inlineText(result.judgeFeedback)}`)
  if (result.evidence !== null) {
    lines.push('', ...jsonBlock(result.evidence).map((line) => (line.length ? `  ${line}` : line)))
  }
  return lines
}

function renderTrialFailure(entry: EvalReportCase, trial: EvalReportTrial, multiTrial: boolean): string[] {
  const title = multiTrial ? `${caseLabel(entry)} — trial ${trial.trialIndex}` : caseLabel(entry)
  const lines = [`### ${inlineText(title)}`, '', `- Status: ${trial.status}`, `- Case run: ${inlineText(trial.caseRunId)}`]
  if (trial.tracePath) lines.push(`- Trace: ${inlineText(trial.tracePath)}`)
  if (entry.flaky) lines.push('- Flaky: yes')
  if (trial.error) lines.push('', 'Error:', '', ...codeFence(trial.error, 'text'))
  const failedResults = trial.results.filter(isFailedResult)
  if (failedResults.length) {
    lines.push('', 'Failed assertions:', '')
    for (const result of failedResults) lines.push(...renderFailedResult(result))
  }
  if (entry.input !== undefined) lines.push('', 'Input:', '', ...jsonBlock(entry.input))
  if (entry.expected !== undefined && entry.expected !== null) {
    lines.push('', 'Expected:', '', ...jsonBlock(entry.expected))
  }
  if (trial.output !== undefined) lines.push('', 'Output:', '', ...jsonBlock(trial.output))
  return lines
}

function renderFailures(report: EvalReport): string[] {
  const multiTrial = report.suiteRun.repeatCount > 1
  const sections: string[][] = []
  for (const entry of report.cases) {
    for (const trial of entry.trials) {
      if (isFailingTrial(trial)) sections.push(renderTrialFailure(entry, trial, multiTrial))
    }
  }
  const lines = ['## Failures', '']
  if (!sections.length) return [...lines, '_No failures._']
  sections.forEach((section, index) => {
    if (index > 0) lines.push('')
    lines.push(...section)
  })
  return lines
}

export function renderEvalReportMarkdown(report: EvalReport): string {
  const sections = [
    renderHeader(report),
    renderGate(report),
    renderSummary(report),
    renderEnvironment(report),
    renderBaseline(report),
    renderAssertions(report),
    renderCases(report),
    renderFailures(report),
  ]
  return `${sections.map((section) => section.join('\n')).join('\n\n')}\n`
}
