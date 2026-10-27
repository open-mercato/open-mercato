import {
  readLlmSpanMetadata,
  type CaptureFidelity,
  type LlmRequestParameters,
  type LlmUsage,
} from '../../lib/trace/genAiAttributes'
import type { SpanView } from '../types'

const LLM_SPAN_KIND = 'llm'
const MICROS_PER_UNIT = 1_000_000
const MICROS_FRACTION_DIGITS = 6
const DEFAULT_CURRENCY = 'USD'

const PARAMETER_LABELS: ReadonlyArray<[keyof LlmRequestParameters, string]> = [
  ['temperature', 'temperature'],
  ['topP', 'top_p'],
  ['topK', 'top_k'],
  ['maxTokens', 'max_tokens'],
  ['seed', 'seed'],
  ['stopSequences', 'stop_sequences'],
  ['presencePenalty', 'presence_penalty'],
  ['frequencyPenalty', 'frequency_penalty'],
]

export type LlmStepParameter = { name: string; value: string }

export type LlmStepRow = {
  id: string
  step: number
  recorded: boolean
  provider: string | null
  requestModel: string | null
  responseModel: string | null
  parameters: LlmStepParameter[]
  usage: LlmUsage
  costMicros: number | null
  currency: string
  latencyMs: number | null
  finishReasons: string[]
  fidelity: CaptureFidelity | null
}

function formatParameterValue(value: number | string[]): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value)
}

function listParameters(params: LlmRequestParameters): LlmStepParameter[] {
  const result: LlmStepParameter[] = []
  for (const [key, name] of PARAMETER_LABELS) {
    const value = params[key]
    if (value === undefined) continue
    result.push({ name, value: formatParameterValue(value) })
  }
  return result
}

function compareSpans(left: SpanView, right: SpanView): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence
  const leftStart = left.startedAt ? Date.parse(left.startedAt) : 0
  const rightStart = right.startedAt ? Date.parse(right.startedAt) : 0
  return leftStart - rightStart
}

export function deriveLlmStepRows(spans: readonly SpanView[], runCurrency: string | null): LlmStepRow[] {
  const llmSpans = spans.filter((span) => span.kind === LLM_SPAN_KIND).sort(compareSpans)
  return llmSpans.map((span, index) => {
    const metadata = readLlmSpanMetadata(span.attributes)
    const requestModel = metadata.requestModel ?? metadata.responseModel ?? null
    const responseModel =
      metadata.responseModel && metadata.responseModel !== requestModel ? metadata.responseModel : null
    return {
      id: span.id,
      step: index + 1,
      recorded: metadata.source === 'gen_ai',
      provider: metadata.providerName ?? null,
      requestModel,
      responseModel,
      parameters: listParameters(metadata.params),
      usage: metadata.usage,
      costMicros: metadata.costMicros ?? null,
      currency: metadata.costCurrency ?? runCurrency ?? DEFAULT_CURRENCY,
      latencyMs: metadata.latencyMs ?? span.durationMs ?? null,
      finishReasons: metadata.finishReasons ?? [],
      fidelity: metadata.fidelity ?? null,
    }
  })
}

export function formatCostMicros(micros: number, currency: string, locale?: string): string {
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: MICROS_FRACTION_DIGITS,
  })
  return `${formatter.format(micros / MICROS_PER_UNIT)} ${currency}`
}

export function fidelityBadgeVariant(fidelity: CaptureFidelity): 'success' | 'warning' | 'info' {
  if (fidelity === 'exact') return 'success'
  if (fidelity === 'reconstructed') return 'warning'
  return 'info'
}
