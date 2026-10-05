import { createHash } from 'node:crypto'
import { canonicalizeEffectiveScope } from './canonicalizeEffectiveScope'
import type { EffectiveAssortmentScope } from './types'

/** 16-hex-character sha256 digest of the canonical scope (SPEC-029 §6.1 truncation). Server-only: uses node:crypto. */
export function hashEffectiveScope(scope: EffectiveAssortmentScope): string {
  return createHash('sha256').update(canonicalizeEffectiveScope(scope)).digest('hex').slice(0, 16)
}
