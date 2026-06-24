/**
 * Shared deterministic scorers (gap-04 single-source-of-truth). Each is a PURE
 * function — inputs in, verdict out, no EntityManager / request scope — so the
 * exact same logic runs online (inline at ingest in EvalRuntimeService) and,
 * later, offline as the CI regression gate. Only deterministic scorers may back
 * a `gate`-severity assertion; non-determinism would make the gate flaky.
 */

export type ScorerRunFacts = {
  confidence?: number | null
  status?: string | null
}

export type ScorerInput = {
  output: unknown
  run: ScorerRunFacts
  config: Record<string, unknown>
}

export type ScorerVerdict = {
  passed: boolean
  score?: number
  evidence?: unknown
}

export type Scorer = (input: ScorerInput) => ScorerVerdict

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

// Non-global patterns (presence detection only) — keeps scorers stateless/pure.
const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'phone', re: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
]

export const scorers: Record<string, Scorer> = {
  /** Passes when the run produced a non-empty output. */
  output_present: ({ output }) => {
    const empty =
      output === null ||
      output === undefined ||
      (typeof output === 'object' && Object.keys(output as object).length === 0)
    return { passed: !empty, score: empty ? 0 : 1 }
  },

  /** Passes when every `config.requiredKeys` is present on the output object. */
  required_keys: ({ output, config }) => {
    const required = Array.isArray(config.requiredKeys) ? (config.requiredKeys as string[]) : []
    if (!output || typeof output !== 'object') {
      return { passed: false, score: 0, evidence: { reason: 'output is not an object' } }
    }
    const present = output as Record<string, unknown>
    const missing = required.filter((key) => !(key in present))
    return {
      passed: missing.length === 0,
      score: required.length ? (required.length - missing.length) / required.length : 1,
      evidence: missing.length ? { missing } : undefined,
    }
  },

  /** Passes when run confidence ≥ `config.threshold` (default 0.5). */
  min_confidence: ({ run, config }) => {
    const threshold = typeof config.threshold === 'number' ? config.threshold : 0.5
    const confidence = typeof run.confidence === 'number' ? run.confidence : null
    if (confidence === null) {
      return { passed: false, score: 0, evidence: { reason: 'run has no confidence' } }
    }
    return { passed: confidence >= threshold, score: confidence, evidence: { confidence, threshold } }
  },

  /** Passes when no PII-shaped substring is detected in the output. */
  no_pii: ({ output }) => {
    const text = toText(output)
    const detected = PII_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name)
    return { passed: detected.length === 0, score: detected.length === 0 ? 1 : 0, evidence: detected.length ? { detected } : undefined }
  },
}

/** Resolve the scorer for an assertion — `config.scorer` overrides, else the assertion key. */
export function getScorer(key: string): Scorer | undefined {
  return scorers[key]
}
