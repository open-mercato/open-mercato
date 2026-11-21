/**
 * Queue names.
 *
 * NOTE: a worker's `metadata.queue` must be a string LITERAL, because the generator extracts
 * it from the AST and cannot resolve an imported constant — a worker referencing this module
 * from `metadata` silently disappears from the registry. The workers therefore repeat the
 * literal and a test asserts it still equals the constant here.
 */
export const MARKETING_DISPATCH_QUEUE = 'marketing-automation-dispatch'
export const MARKETING_RESUME_QUEUE = 'marketing-automation-resume'
export const MARKETING_SWEEP_QUEUE = 'marketing-automation-sweep'
export const MARKETING_SEGMENT_ACTION_QUEUE = 'marketing-automation-segment-action'
export const MARKETING_SCORE_RULES_QUEUE = 'marketing-automation-score-rules'
