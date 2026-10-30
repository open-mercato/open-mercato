/**
 * Scheduling constants for the per-definition KPI rollup (spec §8.5).
 *
 * Kept in their own module so `setup.ts` can import them without dragging in
 * the ORM entities that `rollup-service.ts` pulls: tenant setup runs on a path
 * where importing the whole engine would be a needless cost.
 */

/**
 * Queue the scheduled tick targets. Duplicated as a string literal in
 * `workers/workflow-definition-metric-rollup.worker.ts` because the generator's
 * AST extractor cannot resolve an imported queue name — see the NOTE there.
 * `workers/__tests__/definition-metric-rollup.worker.test.ts` asserts the two
 * spellings stay identical, so the duplication cannot drift.
 */
export const WORKFLOW_DEFINITION_METRIC_ROLLUP_QUEUE = 'workflow-definition-metric-rollup'

/**
 * How often a rollup pass runs, as a `@open-mercato/scheduler` interval.
 *
 * Matched to `WORKFLOW_ROLLUP_BUCKET_MS` (15 minutes): ticking faster than the
 * bucket only rewrites the same row with the same numbers, and ticking slower
 * leaves buckets with no row at all, which the read route then has to
 * live-compute.
 */
export const WORKFLOW_DEFINITION_METRIC_ROLLUP_INTERVAL = '900s'
