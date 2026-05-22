/**
 * Module-root AI tool contribution for the customers module
 * (Phase 1 WS-C, Step 3.9 — read-only Phase 1 surface).
 *
 * The generator walks every module for a top-level `ai-tools.ts` and takes
 * the default/`aiTools` export as the contribution. This file aggregates the
 * six customers packs (people, companies, deals, activities+tasks,
 * addresses+tags, settings) so they all flow through the existing
 * `ai-tools.generated.ts` pipeline without any generator changes.
 *
 * Mutation tools are deferred to Step 5.13+ under the pending-action contract;
 * every tool here is read-only and enforces tenant + organization scoping via
 * the existing encryption helpers. See
 * `.ai/runs/2026-04-18-ai-framework-unification/step-3.9-checks.md` for the
 * matrix of required features and decisions.
 */
import peopleAiTools from './ai-tools/people-pack'
import companiesAiTools from './ai-tools/companies-pack'
import dealsAiTools from './ai-tools/deals-pack'
import activitiesTasksAiTools from './ai-tools/activities-tasks-pack'
import addressesTagsAiTools from './ai-tools/addresses-tags-pack'
import settingsAiTools from './ai-tools/settings-pack'
import dealAnalyzerAiTools from './ai-tools/deal-analyzer-pack'
import type { CustomersAiToolDefinition } from './ai-tools/types'

export const aiTools: CustomersAiToolDefinition[] = [
  ...peopleAiTools,
  ...companiesAiTools,
  ...dealsAiTools,
  ...activitiesTasksAiTools,
  ...addressesTagsAiTools,
  ...settingsAiTools,
  ...dealAnalyzerAiTools,
]

export default aiTools
