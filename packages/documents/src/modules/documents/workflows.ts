/**
 * Documents Module — Workflow Integration
 *
 * Declares `documents.finding.ingest` as a workflow-safe command so a review
 * workflow can persist reviewer findings through UPDATE_ENTITY. The declaration
 * is a candidate only: it stays off until a tenant administrator enables it in
 * the workflow command policy, the acting user must hold `documents.edit`, and
 * the command itself still requires the editor tier on the document.
 */

import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  {
    commandId: 'documents.finding.ingest',
    requiredFeatures: ['documents.edit'],
    labelKey: 'documents.workflows.commands.finding.ingest',
  },
])

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'documents',
  workflows: [],
})

export default workflowsConfig
