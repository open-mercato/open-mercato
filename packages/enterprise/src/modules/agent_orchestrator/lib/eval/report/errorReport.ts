import { EVAL_REPORT_SCHEMA, EVAL_REPORT_SCHEMA_VERSION, type EvalReport } from './reportSchema'

export const EVAL_ERROR_REPORT_MESSAGE_MAX_CHARS = 2000

export type BuildEvalErrorReportInput = {
  agentDefinitionId: string
  message: string
  suiteRunId?: string | null
  releaseId?: string | null
  evalSetVersion?: string | null
  repeatCount?: number
  cliVersion?: string | null
  env?: Record<string, string | undefined>
  now?: () => Date
}

function firstLine(message: string): string {
  const line = message.split('\n')[0] ?? ''
  return line.length > EVAL_ERROR_REPORT_MESSAGE_MAX_CHARS
    ? `${line.slice(0, EVAL_ERROR_REPORT_MESSAGE_MAX_CHARS)}…`
    : line
}

/**
 * The minimal, schema-valid report written when the eval run itself throws.
 * Only the first line of the message travels (never a stack trace), surfaced
 * as the single baseline warning so every renderer shows it.
 */
export function buildEvalErrorReport(input: BuildEvalErrorReportInput): EvalReport {
  const env = input.env ?? process.env
  const now = input.now ?? (() => new Date())
  const version = input.evalSetVersion ?? null
  return {
    schema: EVAL_REPORT_SCHEMA,
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    status: 'error',
    suiteRun: {
      id: input.suiteRunId ?? '',
      agentId: input.agentDefinitionId,
      trigger: 'ci',
      outcome: null,
      passScore: null,
      scoreVariance: null,
      repeatCount: input.repeatCount && input.repeatCount > 0 ? input.repeatCount : 1,
      judgeMayGate: false,
      startedAt: null,
      finishedAt: null,
      releaseId: input.releaseId ?? null,
    },
    evalSet: {
      version,
      pinKind: !version ? 'none' : version.startsWith('sha256:') ? 'hash' : 'label',
      manifestHash: null,
      label: version && !version.startsWith('sha256:') ? version : null,
      source: 'db',
      caseCount: 0,
      assertionCount: 0,
    },
    baseline: {
      suiteRunId: null,
      manifestHash: null,
      sameDataset: null,
      warnings: [firstLine(input.message)],
    },
    environment: {
      models: [],
      modelSettings: {},
      toolMode: 'live',
      modelMode: 'live',
      gitSha: env.GITHUB_SHA || env.OM_EVAL_GIT_SHA || null,
      cliVersion: input.cliVersion ?? null,
    },
    totals: {
      cases: 0,
      trials: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      skipped: 0,
      flakyCases: 0,
      costMinor: null,
      currency: null,
      latencyMs: { p50: null, p95: null, max: null },
      tokens: { input: null, output: null },
    },
    assertions: [],
    regressions: [],
    cases: [],
  }
}
