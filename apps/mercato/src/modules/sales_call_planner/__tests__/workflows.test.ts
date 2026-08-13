import '../workflows'
import { ensureTaskCommand } from '../commands/ensureTask'
import { getWorkflowSafeCommand } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

const COMMAND_ID = 'sales_call_planner.ensure_task'

describe('sales_call_planner workflow-safe command declaration', () => {
  it('registers the ensure-task command as an UPDATE_ENTITY candidate', () => {
    const declared = getWorkflowSafeCommand(COMMAND_ID)
    expect(declared).not.toBeNull()
    expect(declared?.requiredFeatures).toEqual(['customers.interactions.manage'])
    expect(declared?.labelKey).toBe('sales_call_planner.workflows.commands.ensureTask')
  })

  it('ships OFF: defaultEnabled is a grandfather clause and this candidate is new', () => {
    // A tenant that never saved the workflow-command setting resolves to exactly
    // the flagged entries. Setting it here would hand this module the tenant's
    // decision instead of failing closed.
    expect(getWorkflowSafeCommand(COMMAND_ID)?.defaultEnabled).toBeUndefined()
  })

  it('declares the id the command handler actually registers', () => {
    // The id is spelled out in workflows.ts so the declaration does not drag the
    // command module into the bootstrap graph; this is what keeps the two
    // spellings from drifting apart silently.
    expect(ensureTaskCommand.id).toBe(COMMAND_ID)
  })
})
