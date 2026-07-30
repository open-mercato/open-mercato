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
    // Declaring a definition's own execution grant is strictly broader than
    // editing it: the grant decides which ACL features EVERY run of that
    // version executes with, so folding it into `definitions.edit` would let
    // any workflow author mint a principal with powers they were never given.
    // It is additionally bounded at save time — a grant can never exceed the
    // saving user's own current features.
    id: 'workflows.definitions.grant_features',
    title: 'Grant execution features to workflow definitions',
    module: moduleId,
    dependsOn: ['workflows.definitions.edit'],
  },
  {
    id: 'workflows.definitions.test_run',
    title: 'Test workflow definition steps',
    module: moduleId,
    dependsOn: ['workflows.definitions.edit'],
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
    // Writing arbitrary run context is strictly broader than sending a named
    // signal, so it is deliberately NOT folded into workflows.instances.signal.
    id: 'workflows.instances.update_context',
    title: 'Update workflow instance context',
    module: moduleId,
    dependsOn: ['workflows.instances.view'],
  },
  {
    // Spec 8.4 ACL appendix: `workflows.instances.rerun_step` (admins/devs).
    // Replaying a step re-executes real side effects with possibly EDITED
    // context, which `workflows.instances.retry` (replay the run as it stands)
    // does not authorise — hence its own feature rather than an implication.
    id: 'workflows.instances.rerun_step',
    title: 'Rerun a workflow instance from a step',
    module: moduleId,
    dependsOn: ['workflows.instances.retry', 'workflows.instances.update_context'],
  },
  {
    // Spec 8.4 ACL appendix: `workflows.instances.bulk_ops` (admins). Retrying
    // or cancelling a page of instances at once is strictly broader than doing
    // it one row at a time — a misfire re-executes hundreds of real workflows —
    // so it is its own feature rather than an implication of `retry`/`cancel`.
    id: 'workflows.instances.bulk_ops',
    title: 'Bulk retry or cancel workflow instances',
    module: moduleId,
    dependsOn: ['workflows.instances.retry', 'workflows.instances.cancel'],
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
    // Administration, per spec §6.4: `workflows.tasks.*` gates viewing OTHER
    // people's work, never one's own. Reading a task you have no relationship
    // to still passes the same entity gate — this widens WHOSE rows you see,
    // not WHICH entities you may see them about. It deliberately grants no act:
    // an administrator reassigns a task to themselves (audited) before they can
    // complete it, which is what keeps "who approved this?" answerable.
    //
    // `dependsOn: ['workflows.tasks.view']` keeps the older id load-bearing
    // rather than leaving it a stored-but-unconsulted grant: it still admits a
    // caller to the task API, and this feature decides which rows come back.
    id: 'workflows.tasks.view_all',
    title: 'View all workflow tasks',
    module: moduleId,
    dependsOn: ['workflows.tasks.view'],
  },
  {
    // The ONLY supported route from "I can see this task" to "I can act on it".
    // Writes the reassignment audit columns plus a WorkflowEvent.
    id: 'workflows.tasks.reassign',
    title: 'Reassign workflow tasks',
    module: moduleId,
    dependsOn: ['workflows.tasks.view_all'],
  },
  {
    // Administrative mutations that are not reassignment: force-unclaim, cancel,
    // bulk operations, and writing the tenant task-permission setting.
    id: 'workflows.tasks.manage',
    title: 'Administer workflow tasks',
    module: moduleId,
    dependsOn: ['workflows.tasks.view_all'],
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
  {
    // Spec §8.5 operations KPIs. Its own feature rather than an implication of
    // `definitions.view`: a rollup states how often a process fails and how
    // long it takes across every run in the organization, which is an
    // aggregate over runs the caller may not be entitled to open one by one.
    // `dependsOn: ['workflows.definitions.view']` because a KPI without the
    // definition it belongs to names nothing the reader can act on.
    id: 'workflows.metrics.view',
    title: 'View workflow operational metrics',
    module: moduleId,
    dependsOn: ['workflows.definitions.view'],
  },
  // Note: Event triggers are now embedded in workflow definitions.
  // Trigger management permissions are covered by workflows.definitions.edit
]

export default features
