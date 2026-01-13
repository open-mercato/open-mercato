/**
 * Workflows Module - Access Control Features
 *
 * Defines all RBAC features provided by the workflows module.
 */

const workflowFeatures = [
  // Workflow Definitions
  'workflows.definitions.view', // View workflow definitions
  'workflows.definitions.create', // Create new workflow definitions
  'workflows.definitions.edit', // Edit workflow definitions
  'workflows.definitions.delete', // Delete workflow definitions

  // Workflow Instances
  'workflows.instances.view', // View workflow instances
  'workflows.instances.create', // Start new workflow instances
  'workflows.instances.cancel', // Cancel running instances
  'workflows.instances.retry', // Retry failed instances
  'workflows.instances.signal', // Send signal to workflow instance

  // User Tasks
  'workflows.tasks.view', // View user tasks
  'workflows.tasks.claim', // Claim tasks from role queue
  'workflows.tasks.complete', // Complete assigned tasks

  // Signals
  'workflows.signals.send', // Send signals by correlation key

  // Logs and Events
  'workflows.events.view', // View execution history and events
]

export const features = workflowFeatures
export default workflowFeatures
