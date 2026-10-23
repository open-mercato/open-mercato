import fs from 'node:fs'
import path from 'node:path'
import { escapeMarkdownCell, renderEvalReportMarkdown } from '../lib/eval/report/renderMarkdown'
import {
  escapeXmlAttribute,
  escapeXmlText,
  renderEvalReportJunit,
  wrapCdata,
} from '../lib/eval/report/renderJunit'
import {
  evalReportSchema,
  type EvalReport,
  type EvalReportCase,
  type EvalReportResult,
  type EvalReportTrial,
} from '../lib/eval/report/reportSchema'

const FIXTURES_DIR = path.join(__dirname, 'fixtures')

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')
}

function result(overrides: Partial<EvalReportResult> & Pick<EvalReportResult, 'assertionKey'>): EvalReportResult {
  return {
    scorerKey: 'exact_match',
    type: 'deterministic',
    severity: 'gate',
    passed: true,
    score: 1,
    evidence: null,
    judgeFeedback: null,
    skipReason: null,
    ...overrides,
  }
}

function trial(overrides: Partial<EvalReportTrial> & Pick<EvalReportTrial, 'trialIndex' | 'caseRunId'>): EvalReportTrial {
  return {
    status: 'passed',
    score: 1,
    latencyMs: 1200,
    costMinor: 3,
    agentRunId: null,
    tracePath: null,
    error: null,
    results: [],
    ...overrides,
  }
}

function evalCase(overrides: Partial<EvalReportCase> & Pick<EvalReportCase, 'id' | 'key'>): EvalReportCase {
  return {
    name: null,
    source: 'file',
    flaky: false,
    baselineStatus: 'passed',
    trials: [],
    ...overrides,
  }
}

function baseReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    schema: 'open-mercato.agent-eval-report',
    schemaVersion: 1,
    generatedAt: '2026-10-22T12:00:00.000Z',
    status: 'completed',
    suiteRun: {
      id: 'suite-1',
      agentId: 'invoice_triage',
      trigger: 'ci',
      outcome: 'failed',
      passScore: 0.5,
      scoreVariance: 0.0625,
      repeatCount: 2,
      judgeMayGate: false,
      startedAt: '2026-10-22T11:58:00.000Z',
      finishedAt: '2026-10-22T11:59:30.000Z',
      releaseId: null,
    },
    evalSet: {
      version: 'sha256:abc123',
      pinKind: 'hash',
      manifestHash: 'sha256:abc123',
      label: 'regression',
      source: 'file',
      caseCount: 2,
      assertionCount: 2,
    },
    baseline: {
      suiteRunId: 'suite-0',
      manifestHash: 'sha256:abc123',
      sameDataset: true,
      warnings: [],
    },
    environment: {
      models: ['openai/gpt-5-mini'],
      modelSettings: { temperature: 0, seed: { requested: 42, honored: 'unknown' } },
      toolMode: 'replay',
      modelMode: 'live',
      gitSha: 'deadbeef',
      cliVersion: '0.9.0',
    },
    totals: {
      cases: 2,
      trials: 4,
      passed: 2,
      failed: 1,
      errored: 1,
      skipped: 0,
      flakyCases: 1,
      costMinor: 12,
      currency: 'USD',
      latencyMs: { p50: 1200, p95: 3000, max: 3000 },
      tokens: { input: 900, output: 300 },
    },
    assertions: [
      {
        key: 'amount_matches',
        scorerKey: 'exact_match',
        type: 'deterministic',
        severity: 'gate',
        passRate: 0.5,
        passed: 1,
        failed: 1,
        skipped: 0,
        baselinePassRate: 1,
        delta: -0.5,
        regressed: true,
        flaky: true,
      },
      {
        key: 'rationale_quality',
        scorerKey: 'llm_judge',
        type: 'llm_judge',
        severity: 'advisory',
        passRate: 1,
        passed: 3,
        failed: 0,
        skipped: 0,
        baselinePassRate: 0.75,
        delta: 0.25,
        regressed: false,
        flaky: false,
      },
    ],
    regressions: ['amount_matches'],
    cases: [
      evalCase({
        id: 'case-a',
        key: 'invoice-overdue',
        name: 'Overdue invoice',
        flaky: true,
        trials: [
          trial({
            trialIndex: 0,
            caseRunId: 'cr-a0',
            agentRunId: 'run-a0',
            tracePath: '/backend/traces/run-a0',
            results: [
              result({ assertionKey: 'amount_matches' }),
              result({
                assertionKey: 'rationale_quality',
                scorerKey: 'llm_judge',
                type: 'llm_judge',
                severity: 'advisory',
                score: 0.9,
                judgeFeedback: 'Cites the due date.',
              }),
            ],
          }),
          trial({
            trialIndex: 1,
            caseRunId: 'cr-a1',
            status: 'failed',
            score: 0.5,
            latencyMs: 3000,
            agentRunId: 'run-a1',
            tracePath: '/backend/traces/run-a1',
            results: [
              result({
                assertionKey: 'amount_matches',
                passed: false,
                score: 0,
                evidence: { expected: 120, actual: 210 },
              }),
              result({
                assertionKey: 'rationale_quality',
                scorerKey: 'llm_judge',
                type: 'llm_judge',
                severity: 'advisory',
                score: 0.8,
              }),
            ],
          }),
        ],
      }),
      evalCase({
        id: 'case-b',
        key: 'invoice-paid',
        baselineStatus: 'absent',
        trials: [
          trial({ trialIndex: 0, caseRunId: 'cr-b0', latencyMs: 900, costMinor: 2 }),
          trial({
            trialIndex: 1,
            caseRunId: 'cr-b1',
            status: 'error',
            score: null,
            latencyMs: null,
            costMinor: null,
            error: 'Provider timeout',
          }),
        ],
      }),
    ],
    ...overrides,
  }
}

function singleTrialReport(overrides: { caseOverrides?: Partial<EvalReportCase>; trialOverrides?: Partial<EvalReportTrial> } = {}): EvalReport {
  const report = baseReport()
  return {
    ...report,
    suiteRun: { ...report.suiteRun, repeatCount: 1 },
    cases: [
      evalCase({
        id: 'case-x',
        key: 'case-x',
        ...overrides.caseOverrides,
        trials: [trial({ trialIndex: 0, caseRunId: 'cr-x0', ...overrides.trialOverrides })],
      }),
    ],
  }
}

type XmlCheck = { wellFormed: boolean; reason?: string; elements: string[] }

function checkXmlWellFormed(xml: string): XmlCheck {
  const elements: string[] = []
  const stack: string[] = []
  let position = 0
  const declaration = xml.match(/^<\?xml[^?]*\?>/)
  if (declaration) position = declaration[0].length
  while (position < xml.length) {
    const nextTag = xml.indexOf('<', position)
    const textEnd = nextTag === -1 ? xml.length : nextTag
    const text = xml.slice(position, textEnd)
    if (/[<>]/.test(text)) return { wellFormed: false, reason: `raw angle bracket in text: ${text}`, elements }
    if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(text)) return { wellFormed: false, reason: `bare ampersand: ${text}`, elements }
    if (!stack.length && text.trim().length) return { wellFormed: false, reason: 'text outside the root element', elements }
    if (nextTag === -1) break
    if (xml.startsWith('<![CDATA[', nextTag)) {
      const cdataEnd = xml.indexOf(']]>', nextTag + 9)
      if (cdataEnd === -1) return { wellFormed: false, reason: 'unterminated CDATA', elements }
      position = cdataEnd + 3
      continue
    }
    const tagEnd = xml.indexOf('>', nextTag)
    if (tagEnd === -1) return { wellFormed: false, reason: 'unterminated tag', elements }
    const tag = xml.slice(nextTag, tagEnd + 1)
    position = tagEnd + 1
    const closing = tag.match(/^<\/([A-Za-z][\w.-]*)\s*>$/)
    if (closing) {
      if (stack.pop() !== closing[1]) return { wellFormed: false, reason: `mismatched </${closing[1]}>`, elements }
      continue
    }
    const opening = tag.match(/^<([A-Za-z][\w.-]*)((?:\s+[A-Za-z][\w.-]*="[^"<]*")*)\s*(\/?)>$/)
    if (!opening) return { wellFormed: false, reason: `malformed tag: ${tag}`, elements }
    const attributeValues = [...opening[2].matchAll(/="([^"]*)"/g)].map((match) => match[1])
    if (attributeValues.some((value) => /&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(value))) {
      return { wellFormed: false, reason: `bare ampersand in attribute: ${tag}`, elements }
    }
    if (!stack.length && elements.length) return { wellFormed: false, reason: 'multiple root elements', elements }
    elements.push(opening[1])
    if (!opening[3]) stack.push(opening[1])
  }
  if (stack.length) return { wellFormed: false, reason: `unclosed elements: ${stack.join(', ')}`, elements }
  return { wellFormed: true, elements }
}

function cdataContents(xml: string): string[] {
  return [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((match) => match[1])
}

function joinCdataSegments(segment: string): string {
  return cdataContents(segment).join('')
}

describe('eval report renderers', () => {
  it('builds fixtures that satisfy the report schema', () => {
    expect(evalReportSchema.safeParse(baseReport()).success).toBe(true)
    expect(evalReportSchema.safeParse(singleTrialReport()).success).toBe(true)
  })

  describe('renderEvalReportMarkdown', () => {
    it('matches the golden Markdown file', () => {
      expect(renderEvalReportMarkdown(baseReport())).toBe(readFixture('eval-report.golden.md'))
    })

    it('is deterministic for the same report', () => {
      expect(renderEvalReportMarkdown(baseReport())).toBe(renderEvalReportMarkdown(baseReport()))
    })

    it('renders an empty, passing report without failures', () => {
      const report = baseReport({ cases: [], assertions: [], regressions: [] })
      const markdown = renderEvalReportMarkdown({ ...report, suiteRun: { ...report.suiteRun, outcome: 'passed' } })
      expect(markdown).toContain('**Verdict: PASSED**')
      expect(markdown).toContain('_No assertions._')
      expect(markdown).toContain('_No cases._')
      expect(markdown).toContain('_No failures._')
      expect(markdown).not.toContain('### Regressions')
    })

    it('reports a missing gate verdict as not evaluated', () => {
      const report = baseReport()
      const markdown = renderEvalReportMarkdown({ ...report, suiteRun: { ...report.suiteRun, outcome: null } })
      expect(markdown).toContain('**Verdict: NOT EVALUATED**')
    })

    it('escapes pipes and newlines in table cells', () => {
      expect(escapeMarkdownCell('a|b\nc\r\nd\\e')).toBe('a\\|b<br>c<br>d\\\\e')
      const markdown = renderEvalReportMarkdown(
        singleTrialReport({ caseOverrides: { key: 'pipe|key', name: 'line one\nline two' } }),
      )
      expect(markdown).toContain('| pipe\\|key (line one<br>line two) | file | passed |')
      const caseRows = markdown.split('\n').filter((line) => line.startsWith('| pipe'))
      expect(caseRows).toHaveLength(1)
    })

    it('fences evidence containing backticks with a longer fence', () => {
      const markdown = renderEvalReportMarkdown(
        singleTrialReport({
          trialOverrides: {
            status: 'failed',
            results: [result({ assertionKey: 'shape', passed: false, evidence: 'got ``` inside' })],
          },
        }),
      )
      expect(markdown).toContain('  ````text\n  got ``` inside\n  ````')
    })

    it('includes payloads only when the report carries them', () => {
      const withoutPayloads = renderEvalReportMarkdown(
        singleTrialReport({ trialOverrides: { status: 'failed' } }),
      )
      expect(withoutPayloads).not.toContain('Input:')
      expect(withoutPayloads).not.toContain('Output:')
      const withPayloads = renderEvalReportMarkdown(
        singleTrialReport({
          caseOverrides: { input: { invoiceId: 'inv-1' }, expected: { action: 'remind' } },
          trialOverrides: { status: 'failed', output: { action: 'ignore' } },
        }),
      )
      expect(withPayloads).toContain('Input:\n\n```json\n{\n  "invoiceId": "inv-1"\n}\n```')
      expect(withPayloads).toContain('Expected:\n\n```json\n{\n  "action": "remind"\n}\n```')
      expect(withPayloads).toContain('Output:\n\n```json\n{\n  "action": "ignore"\n}\n```')
    })

    it('renders baseline warnings', () => {
      const report = baseReport()
      const markdown = renderEvalReportMarkdown({
        ...report,
        baseline: { ...report.baseline, sameDataset: false, warnings: ['dataset drift: label regression'] },
      })
      expect(markdown).toContain('- Same dataset: no')
      expect(markdown).toContain('### Warnings\n\n- dataset drift: label regression')
    })
  })

  describe('renderEvalReportJunit', () => {
    it('matches the golden JUnit file', () => {
      expect(renderEvalReportJunit(baseReport())).toBe(readFixture('eval-report.golden.xml'))
    })

    it('produces well-formed XML with the JUnit element structure', () => {
      const check = checkXmlWellFormed(renderEvalReportJunit(baseReport()))
      expect(check.reason).toBeUndefined()
      expect(check.wellFormed).toBe(true)
      expect(check.elements[0]).toBe('testsuites')
      expect(check.elements.filter((name) => name === 'testsuite')).toHaveLength(1)
      expect(check.elements.filter((name) => name === 'testcase')).toHaveLength(4)
      expect(check.elements.filter((name) => name === 'failure')).toHaveLength(1)
      expect(check.elements.filter((name) => name === 'error')).toHaveLength(1)
    })

    it('escapes XML special characters in attributes and text', () => {
      expect(escapeXmlText('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d')
      expect(escapeXmlAttribute(`say "hi" & 'bye'\n<x>`)).toBe(
        'say &quot;hi&quot; &amp; &apos;bye&apos;&#10;&lt;x&gt;',
      )
      expect(escapeXmlText('bell\u0007char')).toBe('bellchar')
      const xml = renderEvalReportJunit(
        singleTrialReport({
          caseOverrides: { key: 'a<b>&"c"', name: "it's" },
          trialOverrides: { status: 'error', error: 'boom <tag> & "quoted"\nsecond line' },
        }),
      )
      expect(xml).toContain('name="a&lt;b&gt;&amp;&quot;c&quot; (it&apos;s)"')
      expect(xml).toContain('<error message="boom &lt;tag&gt; &amp; &quot;quoted&quot;" type="error">')
      expect(checkXmlWellFormed(xml).wellFormed).toBe(true)
    })

    it('splits CDATA terminators inside evidence', () => {
      expect(wrapCdata('a]]>b')).toBe('<![CDATA[a]]]]><![CDATA[>b]]>')
      expect(joinCdataSegments(wrapCdata('x]]>y]]>z'))).toBe('x]]>y]]>z')
      const xml = renderEvalReportJunit(
        singleTrialReport({
          trialOverrides: {
            status: 'failed',
            results: [
              result({ assertionKey: 'shape', passed: false, evidence: 'payload ]]> <script>&amp;' }),
            ],
          },
        }),
      )
      const check = checkXmlWellFormed(xml)
      expect(check.reason).toBeUndefined()
      const failureBody = xml.slice(xml.indexOf('<failure'), xml.indexOf('</failure>'))
      expect(joinCdataSegments(failureBody)).toContain('payload ]]> <script>&amp;')
    })

    it('marks flaky cases with a property and a system-out line', () => {
      const xml = renderEvalReportJunit(baseReport())
      const flakyCase = xml.slice(xml.indexOf('<testcase name="invoice-overdue'), xml.indexOf('<testcase name="invoice-paid'))
      expect(flakyCase.match(/<property name="flaky" value="true"\/>/g)).toHaveLength(2)
      expect(flakyCase).toContain('FLAKY: verdicts differ across trials of this case')
      const stableCase = xml.slice(xml.indexOf('<testcase name="invoice-paid'))
      expect(stableCase).not.toContain('name="flaky"')
    })

    it('maps skipped and unfinished trials to skipped elements', () => {
      const skipped = renderEvalReportJunit(
        singleTrialReport({
          trialOverrides: {
            status: 'skipped',
            results: [result({ assertionKey: 'shape', passed: null, skipReason: 'invalid_config' })],
          },
        }),
      )
      expect(skipped).toContain('<skipped message="invalid_config"/>')
      expect(skipped).toContain('skipped="1"')
      const running = renderEvalReportJunit(singleTrialReport({ trialOverrides: { status: 'running' } }))
      expect(running).toContain('<skipped message="not finished (running)"/>')
    })

    it('puts payloads in system-out only when present', () => {
      const withoutPayloads = renderEvalReportJunit(singleTrialReport())
      expect(withoutPayloads).not.toContain('Output:')
      const withPayloads = renderEvalReportJunit(
        singleTrialReport({ trialOverrides: { output: { action: '<ignore>' } } }),
      )
      const systemOut = withPayloads.slice(withPayloads.indexOf('<system-out>'), withPayloads.indexOf('</system-out>'))
      expect(joinCdataSegments(systemOut)).toContain('Output:\n{\n  "action": "<ignore>"\n}')
    })
  })
})
