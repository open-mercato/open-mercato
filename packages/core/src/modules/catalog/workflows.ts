/**
 * Catalog Module — Workflow Integration
 *
 * Declares which catalog commands a workflow's UPDATE_ENTITY activity MAY
 * execute. A declaration here is a CANDIDATE, not a grant: it is off for every
 * tenant until an administrator ticks it in Workflow settings, and the acting
 * user must still hold the declared features at execution time. See
 * `apps/docs/docs/framework/workflows/entity-updates.mdx` for the reasoning
 * behind declaring updates only.
 *
 * Variants, prices and offers are deliberately NOT declared. They are
 * sub-resources whose correct value depends on the parent product's state at
 * the moment of the write, and a workflow reaches them with context captured
 * before it parked — the same stale-context hazard that keeps deletes out.
 * Price writes in particular belong behind `salesCalculationService` and the
 * pricing rules, not behind a workflow activity setting a column.
 */

import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  {
    commandId: 'catalog.products.update',
    requiredFeatures: ['catalog.products.manage'],
    labelKey: 'catalog.workflows.commands.products.update',
  },
])

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'catalog',
  workflows: [],
})

export default workflowsConfig
