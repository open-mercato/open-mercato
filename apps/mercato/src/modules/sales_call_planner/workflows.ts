/**
 * Sales Call Planner — Workflow Integration
 *
 * Declares `sales_call_planner.ensure_task` as a CANDIDATE for a workflow's
 * `UPDATE_ENTITY` activity. Three gates stand between this declaration and a
 * row being written, and all three must pass:
 *
 *  1. this registration (what the CODE says is possible);
 *  2. the per-tenant Workflow-settings toggle (`lib/workflow-command-enablement.ts`);
 *  3. the acting workflow user holding `customers.interactions.manage` at
 *     execution time.
 *
 * ## Why `defaultEnabled` is absent
 *
 * That flag is a GRANDFATHER CLAUSE for commands that were already reachable
 * before the tenant enablement setting existed — a tenant that never saved the
 * setting resolves to exactly the flagged entries. Setting it on a NEW candidate
 * would be this module handing itself a decision that belongs to the tenant.
 * So this ships OFF everywhere: an administrator must tick it in
 * `Settings → Workflows → Commands` for the deal-briefing workflow's
 * `UPDATE_ENTITY` node to do anything but fail with
 * "UPDATE_ENTITY command is not enabled for this tenant".
 *
 * ## Why `customers.interactions.manage`
 *
 * The command's only effect is writing `CustomerInteraction` rows through
 * `customers.interactions.create` / `.update`. Declaring the feature the
 * customers module already uses for that means a workflow can never write a
 * task an operator could not have written by hand. A candidate declaring no
 * features can never be enabled at all, by design.
 *
 * ## Why the command id is spelled out here
 *
 * Importing it from `commands/ensureTask.ts` would pull the command module into
 * the bootstrap graph and defeat its lazy loader (`command-loaders.generated.ts`
 * imports command files on first resolution). The customers module spells its
 * ids the same way; `__tests__/workflows.test.ts` asserts the two spellings
 * agree, so a rename cannot silently unregister the candidate.
 */

import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  {
    commandId: 'sales_call_planner.ensure_task',
    requiredFeatures: ['customers.interactions.manage'],
    labelKey: 'sales_call_planner.workflows.commands.ensureTask',
  },
])

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'sales_call_planner',
  workflows: [],
})

export default workflowsConfig
