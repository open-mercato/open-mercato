/**
 * Workflows Module - Access Control Features
 *
 * Defines all RBAC features provided by the workflows module.
 */

const workflowFeatures = [
  'workflows.view', // View workflow definitions
  'workflows.create', // Create new workflows
  'workflows.edit', // Edit workflow definitions
  'workflows.delete', // Delete workflows
  'workflows.execute', // Start workflow instances
  'workflows.view_instances', // View running instances
  'workflows.manage_instances', // Cancel, retry instances
  'workflows.view_tasks', // View user tasks
  'workflows.complete_tasks', // Complete assigned tasks
  'workflows.view_logs', // View execution history
]

export const features = workflowFeatures
export default workflowFeatures
