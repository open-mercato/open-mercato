/** Lowest per-organization override of the suggestion support threshold (`suggestionMinSupport`). */
export const XRAY_SUGGESTION_MIN_SUPPORT_FLOOR = 5

/**
 * Automation suggestion mining thresholds (spec "Automation suggestion mining"). A rule
 * "trigger A (and an optional condition) → follow-up field change B within W" is suggested only
 * when every threshold holds in the last `lookbackDays`.
 */
export const XRAY_SUGGESTION_THRESHOLDS = {
  /** Trigger occurrences followed by B within W (overridable per organization, never below `minSupportFloor`). */
  minSupport: 20,
  minSupportFloor: XRAY_SUGGESTION_MIN_SUPPORT_FLOOR,
  /** Lower bound of the 95 % Wilson score interval of `support / triggerCount`. */
  minConfidenceLowerBound: 0.6,
  /** Confidence over the base rate of B after any trigger-eligible activity. */
  minLift: 2,
  /**
   * Distinct people whose manual follow-ups support the rule: the analytics three-actor rule
   * (`XRAY_STATS_GUARDS.minDistinctActors`), so one dominant actor's habit is never suggested.
   */
  minDistinctActors: 3,
} as const

export const XRAY_SUGGESTION_LOOKBACK_DAYS = 30

/** Candidate follow-up windows, smallest first: the smallest window that passes every threshold wins. */
export const XRAY_SUGGESTION_WINDOWS_SECONDS = [600, 3600, 86_400] as const

/** A field is a condition candidate only when the triggers of the process saw at most this many of its values. */
export const XRAY_SUGGESTION_MAX_CONDITION_VALUES = 12

/** At most this many suggestions are kept per process and organization in one pass (best first). */
export const XRAY_SUGGESTION_MAX_PER_PROCESS = 100

/** An organization is mined again once its last pass is at least this old. */
export const XRAY_SUGGESTION_INTERVAL_MS = 24 * 60 * 60_000

/**
 * An on-demand (forced) pass is skipped while the last pass is younger than this, so a manager can
 * start at most one full 30-day pass of an organization per interval on the shared mining queue.
 */
export const XRAY_SUGGESTION_FORCED_MIN_INTERVAL_MS = 15 * 60_000

/**
 * An on-demand request stays pending (a further request enqueues no second job) until the forced
 * job serving it clears it, or at most this long (a lost or failed job never blocks requests for good).
 */
export const XRAY_SUGGESTION_REQUEST_TTL_MS = 15 * 60_000

/** Part of every signature: bump when the meaning of a stored rule changes. */
export const XRAY_SUGGESTION_SIGNATURE_VERSION = 1

/** Slack for comparing computed ratios with the thresholds (floating point). */
export const XRAY_SUGGESTION_EPSILON = 1e-9

export const XRAY_SUGGESTION_STATUSES = ['open', 'dismissed', 'drafted', 'superseded'] as const

export type XraySuggestionStatus = (typeof XRAY_SUGGESTION_STATUSES)[number]

/**
 * Why a suggestion cannot become a workflow draft. Stored reasons come from mining; the draft
 * route recomputes them and may add `command_forbidden` (the caller lacks the command's features).
 */
export const XRAY_SUGGESTION_NOT_DRAFTABLE_REASONS = [
  'trigger_not_expressible',
  'condition_not_expressible',
  'no_command',
  'workflows_unavailable',
  'command_not_workflow_safe',
  'draft_invalid',
  'command_forbidden',
] as const

export type XraySuggestionNotDraftableReason = (typeof XRAY_SUGGESTION_NOT_DRAFTABLE_REASONS)[number]

/** Mutation-guard / optimistic-lock resource kind of a suggestion (resource id: the suggestion id). */
export const XRAY_SUGGESTION_RESOURCE_KIND = 'insights.xray_suggestion'

/** Mutation-guard resource kind of the on-demand mining request (resource id: the organization). */
export const XRAY_SUGGESTION_MINING_RESOURCE_KIND = 'insights.xray_suggestion_mining'
