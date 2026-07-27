import { encode } from 'gpt-tokenizer/encoding/o200k_base'

/**
 * Model-agnostic offline token estimate.
 *
 * Uses the `o200k_base` BPE encoding (GPT-4o / GPT-5 family) as a proxy. It is
 * NOT exact for non-OpenAI models — notably Claude, whose tokenizer is not
 * available offline — but it is deterministic, dependency-light, and a far
 * closer estimate than a chars/4 heuristic. Treat the result as an estimate.
 *
 * Infrastructure only: this file knows nothing about any domain shape. Callers
 * that need to break a structure down into elements assemble their own totals
 * on top of this primitive.
 */
export function countTokens(text: string | null | undefined): number {
  if (!text) return 0
  return encode(text).length
}

/** The BPE encoding backing {@link countTokens}, surfaced so callers can label estimates. */
export const TOKEN_ENCODING = 'o200k_base' as const
