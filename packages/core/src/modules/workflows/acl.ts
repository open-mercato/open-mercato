const moduleId = 'workflows'

export const features = [
  { id: 'workflows.view', title: 'View workflows', module: moduleId },
  { id: 'workflows.manage', title: 'Manage workflows', module: moduleId },
  { id: 'workflows.view_logs', title: 'View workflow logs', module: moduleId },
  { id: 'workflows.view_tasks', title: 'View workflow tasks', module: moduleId },
  { id: 'workflows.definitions.view', title: 'View workflow definitions', module: moduleId },
  { id: 'workflows.definitions.create', title: 'Create workflow definitions', module: moduleId },
  { id: 'workflows.definitions.edit', title: 'Edit workflow definitions', module: moduleId },
  { id: 'workflows.definitions.delete', title: 'Delete workflow definitions', module: moduleId },
  { id: 'workflows.instances.view', title: 'View workflow instances', module: moduleId },
  { id: 'workflows.instances.create', title: 'Start workflow instances', module: moduleId },
  { id: 'workflows.instances.cancel', title: 'Cancel workflow instances', module: moduleId },
  { id: 'workflows.instances.retry', title: 'Retry workflow instances', module: moduleId },
  { id: 'workflows.instances.signal', title: 'Signal workflow instances', module: moduleId },
  { id: 'workflows.tasks.view', title: 'View user tasks', module: moduleId },
  { id: 'workflows.tasks.claim', title: 'Claim workflow tasks', module: moduleId },
  { id: 'workflows.tasks.complete', title: 'Complete workflow tasks', module: moduleId },
  { id: 'workflows.signals.send', title: 'Send workflow signals', module: moduleId },
  { id: 'workflows.events.view', title: 'View workflow events', module: moduleId },
  { id: 'workflows.triggers.view', title: 'View event triggers', module: moduleId },
  { id: 'workflows.triggers.create', title: 'Create event triggers', module: moduleId },
  { id: 'workflows.triggers.edit', title: 'Edit event triggers', module: moduleId },
  { id: 'workflows.triggers.delete', title: 'Delete event triggers', module: moduleId },
]

export default features
