import {
  computeToolArgsKey,
  type ToolReplayCall,
  type ToolReplayFixture,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'

export const EVAL_CASE_MAX_TOOL_MOCKS = 100
export const EVAL_MOCK_UNMATCHED_JOURNAL_MAX = 50
export const EVAL_MOCK_SUMMARY_MAX_BYTES = 1048576
export const EVAL_MOCK_SUMMARY_KEY = 'mocks' as const
export const MOCK_REQUIRED_UNUSED = 'mock_required_unused' as const
export const MOCK_USAGE_TRUNCATED = 'mock_usage_truncated' as const

export type EvalToolMockMatch = 'strict' | 'ordered' | 'any'

/** One hand-authored mock as an eval-set file or a frozen manifest declares it. */
export type EvalToolMockInput = {
  id?: string
  tool: string
  match?: EvalToolMockMatch
  args?: unknown
  output?: unknown
  error?: string
  required?: boolean
}

export type EvalCaseMocksInput = {
  match?: EvalToolMockMatch
  tools: ReadonlyArray<EvalToolMockInput>
}

/** The frozen form: case default applied, ids filled in, `required` explicit. */
export type NormalizedToolMock = {
  id: string
  tool: string
  match: EvalToolMockMatch
  args?: unknown
  output?: unknown
  error?: string
  required: boolean
}

export type CompiledToolMock = {
  id: string
  tool: string
  match: EvalToolMockMatch
  argsKey: string | null
  fixture: { output: unknown; error: { message: string } | null }
  required: boolean
}

export type EvalMockResolution = 'fixture' | 'live' | 'error'

export type EvalCaseMockUsage = {
  used: Array<{ id: string; tool: string; match: EvalToolMockMatch; calls: number }>
  unused: Array<{ id: string; tool: string; required: boolean }>
  unmatched: Array<{
    tool: string
    argsKey: string
    occurrence: number
    toolCallId: string | null
    resolution: EvalMockResolution
  }>
  unmatchedTruncated: boolean
}

export type EvalMockResolver = {
  lookup: (call: ToolReplayCall) => ToolReplayFixture | null
  observeUnmatched: (
    call: Pick<ToolReplayCall, 'toolName' | 'argsKey' | 'occurrence' | 'toolCallId'>,
    resolution: EvalMockResolution,
  ) => void
  usage: () => EvalCaseMockUsage
}

export type EvalRunMockTotals = {
  cases: number
  used: number
  unused: number
  requiredUnused: number
  unmatched: number
}

export type EvalRunMockSummary = {
  byCaseRun?: Record<string, EvalCaseMockUsage>
  totals: EvalRunMockTotals
  truncated?: true
}

/**
 * Applies the case default match mode and fills in missing ids
 * (`<tool>#<n>`, `n` = the mock's 0-based index among this case's mocks for
 * that tool). File order is kept: it is meaningful for `ordered` mocks and for
 * repeated `strict` mocks.
 */
export function normalizeCaseMocks(mocks: EvalCaseMocksInput): NormalizedToolMock[] {
  const caseDefault = mocks.match ?? 'strict'
  const perTool = new Map<string, number>()
  return mocks.tools.map((mock) => {
    const index = perTool.get(mock.tool) ?? 0
    perTool.set(mock.tool, index + 1)
    const normalized: NormalizedToolMock = {
      id: mock.id ?? `${mock.tool}#${index}`,
      tool: mock.tool,
      match: mock.match ?? caseDefault,
      required: mock.required === true,
    }
    if (mock.args !== undefined) normalized.args = mock.args
    if (mock.output !== undefined) normalized.output = mock.output
    if (mock.error !== undefined) normalized.error = mock.error
    return normalized
  })
}

export function compileCaseMocks(
  mocks: EvalCaseMocksInput | null | undefined,
  caseDefaultMatch: EvalToolMockMatch = 'strict',
): CompiledToolMock[] {
  if (!mocks || mocks.tools.length === 0) return []
  return normalizeCaseMocks({ match: mocks.match ?? caseDefaultMatch, tools: mocks.tools }).map((mock) => ({
    id: mock.id,
    tool: mock.tool,
    match: mock.match,
    argsKey: mock.match === 'strict' ? computeToolArgsKey(mock.args ?? null) : null,
    fixture: {
      output: mock.error !== undefined ? null : (mock.output ?? null),
      error: mock.error !== undefined ? { message: mock.error } : null,
    },
    required: mock.required,
  }))
}

/**
 * One resolver per trial, so trials never share consumption state. Precedence
 * per call: the first unconsumed `strict` mock with the same args, then the
 * first unconsumed `ordered` mock for the tool, then the first `any` mock
 * (never consumed).
 */
export function createMockResolver(compiled: ReadonlyArray<CompiledToolMock>): EvalMockResolver {
  const consumed = new Set<number>()
  const calls = compiled.map(() => 0)
  const unmatched: EvalCaseMockUsage['unmatched'] = []
  let unmatchedTruncated = false

  const pick = (call: ToolReplayCall): number => {
    const strict = compiled.findIndex(
      (mock, index) =>
        mock.match === 'strict' && mock.tool === call.toolName && mock.argsKey === call.argsKey && !consumed.has(index),
    )
    if (strict >= 0) return strict
    const ordered = compiled.findIndex(
      (mock, index) => mock.match === 'ordered' && mock.tool === call.toolName && !consumed.has(index),
    )
    if (ordered >= 0) return ordered
    return compiled.findIndex((mock) => mock.match === 'any' && mock.tool === call.toolName)
  }

  return {
    lookup(call) {
      const index = pick(call)
      if (index < 0) return null
      const mock = compiled[index]
      if (mock.match !== 'any') consumed.add(index)
      calls[index] += 1
      return {
        toolName: call.toolName,
        argsKey: call.argsKey,
        args: call.args,
        output: mock.fixture.output,
        error: mock.fixture.error,
        occurrence: call.occurrence,
      }
    },
    observeUnmatched(call, resolution) {
      if (unmatched.length >= EVAL_MOCK_UNMATCHED_JOURNAL_MAX) {
        unmatchedTruncated = true
        return
      }
      unmatched.push({
        tool: call.toolName,
        argsKey: call.argsKey,
        occurrence: call.occurrence,
        toolCallId: call.toolCallId,
        resolution,
      })
    },
    usage() {
      return {
        used: compiled.flatMap((mock, index) =>
          calls[index] > 0 ? [{ id: mock.id, tool: mock.tool, match: mock.match, calls: calls[index] }] : [],
        ),
        unused: compiled.flatMap((mock, index) =>
          calls[index] === 0 ? [{ id: mock.id, tool: mock.tool, required: mock.required }] : [],
        ),
        unmatched: unmatched.map((entry) => ({ ...entry })),
        unmatchedTruncated,
      }
    },
  }
}

export function requiredUnusedMockIds(usage: EvalCaseMockUsage): string[] {
  return usage.unused.filter((entry) => entry.required).map((entry) => entry.id)
}

export function totalMockUsage(usages: ReadonlyArray<EvalCaseMockUsage>): EvalRunMockTotals {
  return {
    cases: usages.length,
    used: usages.reduce((sum, usage) => sum + usage.used.length, 0),
    unused: usages.reduce((sum, usage) => sum + usage.unused.length, 0),
    requiredUnused: usages.reduce((sum, usage) => sum + requiredUnusedMockIds(usage).length, 0),
    unmatched: usages.reduce((sum, usage) => sum + usage.unmatched.length, 0),
  }
}

/**
 * The suite summary block. Above `maxBytes` the per-trial usage is dropped and
 * only the totals are kept, flagged `truncated`.
 */
export function buildEvalRunMockSummary(
  entries: ReadonlyArray<{ caseRunId: string; usage: EvalCaseMockUsage }>,
  maxBytes: number = EVAL_MOCK_SUMMARY_MAX_BYTES,
): EvalRunMockSummary {
  const totals = totalMockUsage(entries.map((entry) => entry.usage))
  const byCaseRun: Record<string, EvalCaseMockUsage> = {}
  for (const entry of entries) byCaseRun[entry.caseRunId] = entry.usage
  const summary: EvalRunMockSummary = { byCaseRun, totals }
  if (Buffer.byteLength(JSON.stringify(summary), 'utf8') <= maxBytes) return summary
  return { totals, truncated: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readEvalRunMockSummary(summary: unknown): EvalRunMockSummary | null {
  if (!isRecord(summary) || !isRecord(summary.__evalRun)) return null
  const block = summary.__evalRun[EVAL_MOCK_SUMMARY_KEY]
  if (!isRecord(block) || !isRecord(block.totals)) return null
  return block as EvalRunMockSummary
}

export function withEvalRunMockSummary(summary: unknown, mocks: EvalRunMockSummary): Record<string, unknown> {
  const base = isRecord(summary) ? summary : {}
  const current = isRecord(base.__evalRun) ? base.__evalRun : {}
  return { ...base, __evalRun: { ...current, [EVAL_MOCK_SUMMARY_KEY]: mocks } }
}

export function formatMockSummaryLine(totals: EvalRunMockTotals): string {
  return `mocks: ${totals.used} used, ${totals.unused} unused (${totals.requiredUnused} required), ${totals.unmatched} unmatched calls`
}
