const moduleId = 'workflows'

export const features = [
  { id: 'workflows.view', title: 'View workflows', module: moduleId },
  {
    id: 'workflows.manage',
    title: 'Manage workflows',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.view_logs',
    title: 'View workflow logs',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.view_tasks',
    title: 'View workflow tasks',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.definitions.view',
    title: 'View workflow definitions',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.definitions.create',
    title: 'Create workflow definitions',
    module: moduleId,
    dependsOn: ['workflows.definitions.view'],
  },
  {
    id: 'workflows.definitions.edit',
    title: 'Edit workflow definitions',
    module: moduleId,
    dependsOn: ['workflows.definitions.view'],
  },
  {
    id: 'workflows.definitions.delete',
    title: 'Delete workflow definitions',
    module: moduleId,
    dependsOn: ['workflows.definitions.view'],
  },
  {
    id: 'workflows.definitions.publish',
    title: 'Publish workflow definition versions',
    module: moduleId,
    dependsOn: ['workflows.definitions.edit'],
  },
  {
    id: 'workflows.instances.view',
    title: 'View workflow instances',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.instances.create',
    title: 'Start workflow instances',
    module: moduleId,
    dependsOn: ['workflows.instances.view', 'workflows.definitions.view'],
  },
  {
    id: 'workflows.instances.cancel',
    title: 'Cancel workflow instances',
    module: moduleId,
    dependsOn: ['workflows.instances.view'],
  },
  {
    id: 'workflows.instances.retry',
    title: 'Retry workflow instances',
    module: moduleId,
    dependsOn: ['workflows.instances.view'],
  },
  {
    id: 'workflows.instances.signal',
    title: 'Signal workflow instances',
    module: moduleId,
    dependsOn: ['workflows.instances.view'],
  },
  {
    id: 'workflows.tasks.view',
    title: 'View user tasks',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.tasks.claim',
    title: 'Claim workflow tasks',
    module: moduleId,
    dependsOn: ['workflows.tasks.view'],
  },
  {
    id: 'workflows.tasks.complete',
    title: 'Complete workflow tasks',
    module: moduleId,
    dependsOn: ['workflows.tasks.view'],
  },
  {
    id: 'workflows.signals.send',
    title: 'Send workflow signals',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  {
    id: 'workflows.events.view',
    title: 'View workflow events',
    module: moduleId,
    dependsOn: ['workflows.view'],
  },
  // Note: Event triggers are now embedded in workflow definitions.
  // Trigger management permissions are covered by workflows.definitions.edit
]

export default features
