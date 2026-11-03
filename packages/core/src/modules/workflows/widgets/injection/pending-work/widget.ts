import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PendingWorkWidget from './widget.client'
import type { RecordContext, RecordData } from './widget.client'

/**
 * Generic "pending work" panel for record detail pages (spec §6.2).
 *
 * `features` is deliberately EMPTY. Visibility comes from the work-inbox
 * query's own tenant/organization scoping and the caller's task assignment —
 * not from a workflows grant. Gating this on `workflows.tasks.view` would hide
 * a person's own approval from them unless an administrator remembered to grant
 * a workflows feature to every role that does frontline work, which is exactly
 * the "tasks render where the work is" promise inverted.
 */
const widget: InjectionWidgetModule<RecordContext, RecordData> = {
  metadata: {
    id: 'workflows.injection.pending-work',
    title: 'Pending work',
    description: 'Open workflow tasks bound to the record on this page',
    features: [],
    priority: 90,
    enabled: true,
  },
  Widget: PendingWorkWidget,
}

export default widget
