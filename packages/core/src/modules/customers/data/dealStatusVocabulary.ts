import { z } from 'zod'

export const DEFAULT_DEAL_STATUS_VOCABULARY = Object.freeze({
  won: Object.freeze(['win', 'won']),
  lost: Object.freeze(['lost', 'loose']),
  closed: Object.freeze(['closed']),
})

const statusAliasesSchema = z.array(z.string().trim().min(1).max(50)).min(1).max(20)

export const dealStatusVocabularySchema = z.object({
  won: statusAliasesSchema,
  lost: statusAliasesSchema,
  closed: statusAliasesSchema,
}).strict().superRefine((vocabulary, context) => {
  const outcomes = ['won', 'lost', 'closed'] as const
  const assigned = new Map<string, string>([
    ['open', 'open'],
    ['in_progress', 'open'],
    ...outcomes.flatMap((outcome) =>
      DEFAULT_DEAL_STATUS_VOCABULARY[outcome].map((value): [string, string] => [value, outcome]),
    ),
  ])
  for (const outcome of outcomes) {
    const seen = new Set<string>()
    vocabulary[outcome].forEach((value, index) => {
      const normalized = value.toLowerCase()
      if (seen.has(normalized) || (assigned.has(normalized) && assigned.get(normalized) !== outcome)) {
        context.addIssue({ code: 'custom', path: [outcome, index], message: '[internal] Conflicting deal status alias' })
      }
      assigned.set(normalized, outcome)
      seen.add(normalized)
    })
  }
})

export type DealStatusVocabulary = {
  readonly [Outcome in keyof z.infer<typeof dealStatusVocabularySchema>]: readonly string[]
}

export const saveDealStatusVocabularySchema = z.object({
  vocabulary: dealStatusVocabularySchema.nullable(),
}).strict()
