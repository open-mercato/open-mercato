import { z } from 'zod'
import type { IntegrityRule } from '../../../data/validators'

/**
 * The read-only "Integrity rules" list the agent detail API returns (spec
 * `2026-10-21-output-integrity-guardrails` → UI/UX): rule id, kind and the
 * action a violation takes. Paths, resolvers and checker config stay out — the
 * list names what runs, not how.
 */
export const integrityRuleListItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  onViolation: z.string().nullable(),
  reviewRoute: z.enum(['flag', 'review']).nullable(),
})
export type IntegrityRuleListItem = z.infer<typeof integrityRuleListItemSchema>

export function listIntegrityRules(rules: readonly IntegrityRule[] | undefined): IntegrityRuleListItem[] {
  return (rules ?? []).map((rule) =>
    rule.kind === 'abstain_or_review'
      ? { id: rule.id, kind: rule.kind, onViolation: null, reviewRoute: rule.needsReview?.route ?? null }
      : { id: rule.id, kind: rule.kind, onViolation: rule.onViolation, reviewRoute: null },
  )
}
