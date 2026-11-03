/**
 * Customers Module — Workflow Integration
 *
 * Declares which customers commands a workflow's UPDATE_ENTITY activity MAY
 * execute. A declaration here is a CANDIDATE, not a grant: it is off for every
 * tenant until an administrator ticks it in Workflow settings, and the acting
 * user must still hold the declared features at execution time. See
 * `apps/docs/docs/framework/workflows/entity-updates.mdx`.
 *
 * ## What is declared, and why only updates
 *
 * "Is a user allowed to do this?" and "is this safe to fire unattended?" are
 * different questions. `UPDATE_ENTITY` carries no idempotency key, activities
 * are retried on failure (`retryPolicy`, default up to 3 attempts), and an
 * event trigger can fire the same workflow repeatedly. An UPDATE converges
 * under all three — setting a field to a literal value twice leaves the same
 * record, which is the module-level rule that workflow activity handlers must
 * be idempotent.
 *
 * CREATE does not converge: a retry after a partial failure, or a trigger
 * storm, turns one business event into N records that nobody asked for and
 * that no bulk remedy exists for. DELETE does not survive stale context: a run
 * parked on a 24h approval task holds a `{{context.id}}` captured before the
 * pause, and the delete lands on whatever holds that id when the run wakes —
 * irreversibly. The reversible expression of both intents is a status update,
 * which the commands below already provide. Neither is declared; adding one
 * needs its own argument, because a candidate in the catalogue is an
 * invitation even when it ships switched off.
 */

import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  {
    commandId: 'customers.deals.update',
    requiredFeatures: ['customers.deals.manage'],
    labelKey: 'customers.workflows.commands.deals.update',
  },
  {
    commandId: 'customers.people.update',
    requiredFeatures: ['customers.people.manage'],
    labelKey: 'customers.workflows.commands.people.update',
  },
  {
    commandId: 'customers.companies.update',
    requiredFeatures: ['customers.companies.manage'],
    labelKey: 'customers.workflows.commands.companies.update',
  },
])

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'customers',
  workflows: [],
})

export default workflowsConfig
