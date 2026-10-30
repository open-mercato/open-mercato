import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EvalGateInput, EvalGateResult } from '../lib/eval/evalGate'
import { buildEvalErrorReport } from '../lib/eval/report/errorReport'
import { evalReportSchema, type EvalReport } from '../lib/eval/report/reportSchema'

const mockRunEvalGate = jest.fn<Promise<EvalGateResult>, [unknown, EvalGateInput]>()
const mockBuildEvalReport = jest.fn<Promise<EvalReport | null>, unknown[]>()
const mockFork = jest.fn(() => ({ forked: true }))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => (key === 'em' ? { fork: mockFork } : undefined),
  })),
}))

jest.mock('../lib/eval/evalGate', () => ({
  runEvalGate: (container: unknown, input: EvalGateInput) => mockRunEvalGate(container, input),
}))

jest.mock('../lib/eval/report/buildEvalReport', () => ({
  buildEvalReport: (...args: unknown[]) => mockBuildEvalReport(...args),
}))

jest.mock('../lib/processes/processProjection', () => ({
  recomputeProcessInstance: jest.fn(),
}))

jest.mock('../data/entities', () => ({
  AgentCorrection: class {},
  AgentProposal: class {},
  AgentRun: class {},
  AgentSpan: class {},
  AgentToolCall: class {},
}))

import cliCommands from '../cli'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

function evalCommand(): ModuleCli {
  const command = cliCommands.find((entry) => entry.command === 'eval')
  if (!command) throw new Error('eval command missing')
  return command
}

function gateResult(overrides: Partial<EvalGateResult> = {}): EvalGateResult {
  return {
    suiteRunId: 'suite-1',
    passScore: 0.9,
    safetyRegressions: [],
    outcome: 'passed',
    caseRunCount: 3,
    errorCount: 0,
    baselineSuiteRunId: null,
    ...overrides,
  }
}

function completedReport(flakyCases = 0): EvalReport {
  const base = buildEvalErrorReport({ agentDefinitionId: 'invoice_triage', message: 'unused' })
  return {
    ...base,
    status: 'completed',
    suiteRun: { ...base.suiteRun, id: 'suite-1', outcome: 'passed', passScore: 0.9 },
    baseline: { ...base.baseline, warnings: [] },
    totals: { ...base.totals, cases: 3, trials: 3, passed: 3, flakyCases },
  }
}

async function runEval(argv: string[]): Promise<number | undefined> {
  process.exitCode = undefined
  await evalCommand().run(argv)
  const code = process.exitCode
  process.exitCode = undefined
  return code === undefined ? undefined : Number(code)
}

const scopeArgs = ['--agent', 'invoice_triage', '--tenant', TENANT_ID, '--org', ORG_ID]

describe('agent_orchestrator eval CLI exit codes and reports', () => {
  let reportDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-eval-cli-'))
    mockRunEvalGate.mockReset()
    mockBuildEvalReport.mockReset()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    delete process.env.OM_EVAL_TENANT_ID
    delete process.env.OM_EVAL_ORG_ID
  })

  afterEach(() => {
    fs.rmSync(reportDir, { recursive: true, force: true })
    jest.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  it('exits 0 on a passing gate and writes json + md by default', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult())
    mockBuildEvalReport.mockResolvedValue(completedReport())
    const code = await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--report', reportDir])
    expect(code).toBeUndefined()
    expect(fs.readdirSync(reportDir).sort()).toEqual(['report.json', 'report.md'])
    const written = JSON.parse(fs.readFileSync(path.join(reportDir, 'report.json'), 'utf8'))
    expect(evalReportSchema.parse(written).status).toBe('completed')
    expect(mockBuildEvalReport).toHaveBeenCalledWith(
      { forked: true },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'suite-1',
      { includePayloads: false },
    )
  })

  it('writes every requested format including junit and forwards --include-payloads', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult())
    mockBuildEvalReport.mockResolvedValue(completedReport())
    const code = await runEval([
      ...scopeArgs,
      '--report', reportDir,
      '--format', 'json,md,junit',
      '--include-payloads', 'true',
    ])
    expect(code).toBeUndefined()
    expect(fs.readdirSync(reportDir).sort()).toEqual(['junit.xml', 'report.json', 'report.md'])
    expect(fs.readFileSync(path.join(reportDir, 'junit.xml'), 'utf8')).toContain('<testsuites')
    expect(fs.readFileSync(path.join(reportDir, 'report.md'), 'utf8').length).toBeGreaterThan(0)
    expect(mockBuildEvalReport.mock.calls[0]?.[3]).toEqual({ includePayloads: true })
  })

  it('exits 1 on a failed stored outcome and still writes the report first', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult({ outcome: 'failed', passScore: 0.4 }))
    mockBuildEvalReport.mockResolvedValue(completedReport())
    const code = await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--report', reportDir, '--format', 'junit'])
    expect(code).toBe(1)
    expect(fs.existsSync(path.join(reportDir, 'junit.xml'))).toBe(true)
  })

  it('narrows a pass to exit 1 when the pass score is below --min-pass-score', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult({ passScore: 0.7 }))
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--min-pass-score', '0.8'])).toBe(1)
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--min-pass-score', '0.7'])).toBeUndefined()
    mockRunEvalGate.mockResolvedValue(gateResult({ passScore: null }))
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--min-pass-score', '0'])).toBe(1)
  })

  it('narrows a pass to exit 1 on flaky cases only with --fail-on-flaky true', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult())
    mockBuildEvalReport.mockResolvedValue(completedReport(2))
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--fail-on-flaky', 'true'])).toBe(1)
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true'])).toBeUndefined()
  })

  it('never widens a failure: narrowing flags keep a failed outcome at exit 1', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult({ outcome: 'failed', passScore: 1 }))
    mockBuildEvalReport.mockResolvedValue(completedReport())
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--min-pass-score', '0', '--fail-on-flaky', 'true'])).toBe(1)
  })

  it('keeps report-only runs at exit 0 even when narrowing flags would fail', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult({ outcome: 'failed', passScore: 0.1 }))
    expect(await runEval([...scopeArgs, '--min-pass-score', '0.9'])).toBeUndefined()
  })

  it('exits 2 when the gate is refused on an advisory run', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult({ outcome: 'advisory' }))
    mockBuildEvalReport.mockResolvedValue(completedReport())
    expect(await runEval([...scopeArgs, '--gate', 'true', '--report', reportDir])).toBe(2)
    expect(fs.existsSync(path.join(reportDir, 'report.json'))).toBe(true)
  })

  it('writes a schema-valid error report without a stack trace when the run throws', async () => {
    const failure = new Error('replay engine exploded')
    failure.stack = 'Error: replay engine exploded\n    at secretFrame (/srv/app/internal.ts:1:1)'
    mockRunEvalGate.mockRejectedValue(failure)
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--report', reportDir, '--format', 'md'])).toBe(1)
    const raw = fs.readFileSync(path.join(reportDir, 'report.json'), 'utf8')
    const report = evalReportSchema.parse(JSON.parse(raw))
    expect(report.status).toBe('error')
    expect(report.baseline.warnings).toEqual(['replay engine exploded'])
    expect(report.evalSet.version).toBe('v1')
    expect(raw).not.toContain('secretFrame')
    expect(fs.readdirSync(reportDir)).toEqual(['report.json'])

    expect(await runEval([...scopeArgs, '--report', reportDir])).toBe(2)
  })

  it('writes an error report and exits 2 when the report cannot be built', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult())
    mockBuildEvalReport.mockRejectedValue(new Error('report build failed'))
    expect(await runEval([...scopeArgs, '--eval-set-version', 'v1', '--gate', 'true', '--report', reportDir])).toBe(2)
    const report = evalReportSchema.parse(JSON.parse(fs.readFileSync(path.join(reportDir, 'report.json'), 'utf8')))
    expect(report.status).toBe('error')
    expect(report.suiteRun.id).toBe('suite-1')
  })

  it('exits 2 when the report directory is not writable', async () => {
    mockRunEvalGate.mockResolvedValue(gateResult())
    mockBuildEvalReport.mockResolvedValue(completedReport())
    const blockingFile = path.join(reportDir, 'occupied')
    fs.writeFileSync(blockingFile, 'x')
    expect(await runEval([...scopeArgs, '--report', blockingFile])).toBe(2)
  })

  it('falls back to OM_EVAL_TENANT_ID / OM_EVAL_ORG_ID when flags are absent', async () => {
    process.env.OM_EVAL_TENANT_ID = TENANT_ID
    process.env.OM_EVAL_ORG_ID = ORG_ID
    mockRunEvalGate.mockResolvedValue(gateResult())
    expect(await runEval(['--agent', 'invoice_triage'])).toBeUndefined()
    expect(mockRunEvalGate.mock.calls[0]?.[1].scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('prefers explicit flags over the env scope fallback', async () => {
    process.env.OM_EVAL_TENANT_ID = 'env-tenant'
    process.env.OM_EVAL_ORG_ID = 'env-org'
    mockRunEvalGate.mockResolvedValue(gateResult())
    await runEval(scopeArgs)
    expect(mockRunEvalGate.mock.calls[0]?.[1].scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it.each([
    ['missing scope', ['--agent', 'invoice_triage']],
    ['bad --format', [...scopeArgs, '--report', 'out', '--format', 'html']],
    ['empty --format', [...scopeArgs, '--report', 'out', '--format', ',']],
    ['--format without --report', [...scopeArgs, '--format', 'json']],
    ['--min-pass-score above 1', [...scopeArgs, '--min-pass-score', '1.5']],
    ['--min-pass-score not a number', [...scopeArgs, '--min-pass-score', 'high']],
    ['--min-pass-score negative', [...scopeArgs, '--min-pass-score', '-0.1']],
    ['bad --fail-on-flaky', [...scopeArgs, '--fail-on-flaky', 'maybe']],
    ['bad --include-payloads', [...scopeArgs, '--include-payloads', 'sometimes']],
    ['bad --repeat', [...scopeArgs, '--repeat', '0']],
  ])('exits 2 on a usage error: %s', async (_label, argv) => {
    expect(await runEval(argv)).toBe(2)
    expect(mockRunEvalGate).not.toHaveBeenCalled()
  })
})
