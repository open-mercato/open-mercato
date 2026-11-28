/**
 * Module-root AI tool contribution for the customers module.
 *
 * The generator walks every module for a top-level `ai-tools.ts` and takes
 * the default/`aiTools` export as the contribution. This file aggregates the
 * customers packs (people, companies, deals, activities+tasks,
 * addresses+tags, settings, deal analysis) so they all flow through the existing
 * `ai-tools.generated.ts` pipeline without any generator changes.
 *
 * Read and mutation tools enforce tenant + organization scoping. Mutations
 * use the pending-action approval contract and command-backed writes;
 * read-only agents cannot expose them. See the framework AI agents guide.
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
