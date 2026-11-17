import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Workflows module injection table.
 *
 * **There is no generic record-page spot.** Every record-detail spot id is
 * per-entity (`detail:<module>.<entity>:<slot>`), so "every bound entity type
 * gets the pending-work widget" (spec §6.2) is delivered by ENUMERATION, one
 * line per detail page. The list below is the honest, complete coverage as of
 * this change — it is not universal. Adding a page means adding a line here,
 * never changing the widget: the widget reads the record from the host page's
 * injection context (`resourceKind` + `resourceId`), which every one of these
 * hosts already publishes.
 *
 * Wired today:
 *   - `detail:customers.person:tabs`
 *   - `detail:customers.company:tabs`
 *   - `detail:customers.deal:tabs`
 *   - `sales.document.detail.order:tabs`
 *
 * The three CRM pages mount it as a tab of their related-content workspace
 * (#7488): the earlier `:footer` placement stacked it as a detached card under
 * the whole detail layout. The footer spots stay available to other modules.
 *
 * **The order detail page deliberately keeps TWO different widgets.** The
 * specialized `order-approval` widget stays in the `:details` column: it
 * completes the approval IN PLACE (approve/reject + comments, gated on
 * `sales.orders.approve`) and it is the one surface in this area that already
 * works end to end. The generic pending-work panel can only LINK to a task, so
 * putting it in the same column would show the same approval twice with the
 * weaker affordance beside the stronger one. It goes on the order's `:tabs`
 * spot instead, where it lists every open item about the order — including work
 * that is not an approval — without competing with the inline control.
 */
const crmPendingWorkTab = {
  widgetId: 'workflows.injection.pending-work',
  kind: 'tab',
  groupId: 'pending-work',
  groupLabel: 'workflows.pendingWork.title',
  icon: 'list-checks',
  // Negative: after the host's built-in tabs (#8020 ordering contract).
  priority: -10,
} as const

export const injectionTable: ModuleInjectionTable = {
  // Inject the order approval widget into the sales order detail page
  'sales.document.detail.order:details': [
    {
      widgetId: 'workflows.injection.order-approval',
      kind: 'group',
      column: 2,
      groupLabel: 'workflows.orderApproval.groupLabel',
      groupDescription: 'workflows.orderApproval.groupDescription',
      priority: 200,
    },
  ],
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'workflows.injection.pending-work',
      kind: 'tab',
      groupLabel: 'workflows.pendingWork.title',
      priority: 40,
    },
  ],
  'detail:customers.person:tabs': [crmPendingWorkTab],
  'detail:customers.company:tabs': [crmPendingWorkTab],
  'detail:customers.deal:tabs': [crmPendingWorkTab],
}

export default injectionTable
