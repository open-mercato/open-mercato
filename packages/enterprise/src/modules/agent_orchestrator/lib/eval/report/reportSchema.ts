import { z } from 'zod'
import type { Json } from '../types'

export const EVAL_REPORT_SCHEMA = 'open-mercato.agent-eval-report' as const
export const EVAL_REPORT_SCHEMA_VERSION = 1 as const

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
)

const caseRunStatusSchema = z.enum(['pending', 'running', 'passed', 'failed', 'error', 'skipped'])

export const evalReportResultSchema = z.object({
  assertionKey: z.string(),
  scorerKey: z.string(),
  type: z.string(),
  severity: z.string(),
  passed: z.boolean().nullable(),
  score: z.number().nullable(),
  evidence: jsonSchema.nullable(),
  judgeFeedback: z.string().nullable(),
  skipReason: z.string().nullable(),
})

export const evalReportTrialSchema = z.object({
  trialIndex: z.number().int().nonnegative(),
  caseRunId: z.string(),
  status: caseRunStatusSchema,
  score: z.number().nullable(),
  latencyMs: z.number().nullable(),
  costMinor: z.number().nullable(),
  agentRunId: z.string().nullable(),
  tracePath: z.string().nullable(),
  error: z.string().nullable(),
  output: jsonSchema.optional(),
  results: z.array(evalReportResultSchema),
})

export const evalReportCaseSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string().nullable(),
  source: z.enum(['db', 'file']),
  flaky: z.boolean(),
  baselineStatus: z.enum(['passed', 'failed', 'error', 'skipped', 'absent']),
  input: jsonSchema.optional(),
  expected: jsonSchema.nullable().optional(),
  trials: z.array(evalReportTrialSchema),
})

export const evalReportAssertionSchema = z.object({
  key: z.string(),
  scorerKey: z.string(),
  type: z.string(),
  severity: z.string(),
  passRate: z.number().nullable(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  baselinePassRate: z.number().nullable(),
  delta: z.number().nullable(),
  regressed: z.boolean(),
  flaky: z.boolean(),
})

export const evalReportSchema = z.object({
  schema: z.literal(EVAL_REPORT_SCHEMA),
  schemaVersion: z.literal(EVAL_REPORT_SCHEMA_VERSION),
  generatedAt: z.string(),
  status: z.enum(['completed', 'failed', 'cancelled', 'running', 'error']),
  suiteRun: z.object({
    id: z.string(),
    agentId: z.string(),
    trigger: z.enum(['manual', 'ci', 'scheduled']),
    outcome: z.enum(['passed', 'failed', 'advisory']).nullable(),
    passScore: z.number().nullable(),
    scoreVariance: z.number().nullable(),
    repeatCount: z.number().int().positive(),
    judgeMayGate: z.boolean(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    releaseId: z.string().nullable(),
  }),
  evalSet: z.object({
    version: z.string().nullable(),
    pinKind: z.enum(['hash', 'label', 'none']),
    manifestHash: z.string().nullable(),
    label: z.string().nullable(),
    source: z.enum(['db', 'file']),
    /** Counts the cases in the frozen manifest, not the cases this run executed (a narrowed run executes fewer). */
    caseCount: z.number().int().nonnegative(),
    assertionCount: z.number().int().nonnegative(),
  }),
  baseline: z.object({
    suiteRunId: z.string().nullable(),
    manifestHash: z.string().nullable(),
    sameDataset: z.boolean().nullable(),
    warnings: z.array(z.string()),
  }),
  environment: z.object({
    models: z.array(z.string()),
    modelSettings: z.object({
      temperature: z.number().optional(),
      seed: z
        .object({
          requested: z.number(),
          honored: z.enum(['yes', 'no', 'unknown']),
        })
        .optional(),
    }),
    toolMode: z.enum(['live', 'replay', 'record', 'mixed', 'unsupported_runtime']),
    modelMode: z.enum(['live', 'scripted']),
    gitSha: z.string().nullable(),
    cliVersion: z.string().nullable(),
  }),
  totals: z.object({
    cases: z.number().int().nonnegative(),
    trials: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    flakyCases: z.number().int().nonnegative(),
    costMinor: z.number().nullable(),
    currency: z.string().nullable(),
    latencyMs: z.object({
      p50: z.number().nullable(),
      p95: z.number().nullable(),
      max: z.number().nullable(),
    }),
    tokens: z.object({
      input: z.number().nullable(),
      output: z.number().nullable(),
    }),
  }),
  assertions: z.array(evalReportAssertionSchema),
  regressions: z.array(z.string()),
  cases: z.array(evalReportCaseSchema),
})

export type EvalReport = z.infer<typeof evalReportSchema>
export type EvalReportStatus = EvalReport['status']
export type EvalReportAssertion = z.infer<typeof evalReportAssertionSchema>
export type EvalReportCase = z.infer<typeof evalReportCaseSchema>
export type EvalReportTrial = z.infer<typeof evalReportTrialSchema>
export type EvalReportResult = z.infer<typeof evalReportResultSchema>
