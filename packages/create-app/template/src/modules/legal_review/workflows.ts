/**
 * Legal Review — Workflow Integration
 *
 * Declares `legal_review.matter.release` as a workflow-safe command so the NDA
 * review workflow can release a matter through UPDATE_ENTITY once the document
 * review clears. Like every new candidate it omits `defaultEnabled`: it stays off
 * until the tenant enables it in the workflow command policy (the example seed
 * in setup.ts does that for demo tenants).
 */

import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { LEGAL_MATTER_RELEASE_COMMAND_ID } from './lib/constants'

registerWorkflowSafeCommands([
  {
    commandId: LEGAL_MATTER_RELEASE_COMMAND_ID,
    requiredFeatures: ['legal_review.matters.manage'],
    labelKey: 'legal_review.workflows.commands.matter.release',
  },
])

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'legal_review',
  workflows: [],
})

export default workflowsConfig
