import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderProductionTabWidget from './widget.client'

/**
 * Feature-gated: `production.orders.manage` covers both viewing the tab's
 * production-order list and creating new draft orders from make-flagged
 * lines (the widget offers no read-only vs write-only split at the ACL
 * layer — a caller without this feature never sees the tab widget load).
 * Tenant-runtime gating (the `production_enabled` toggle, which is
 * per-tenant and can't be expressed as a static ACL feature) is enforced
 * inside the client widget itself — see widget.client.tsx.
 */
const widget: InjectionWidgetModule = {
  metadata: {
    id: 'production.injection.order-production-tab',
    title: 'Production',
    description: 'Production orders linked to this sales order, and drafting new ones from make-flagged lines',
    features: ['production.orders.manage'],
    priority: 60,
  },
  Widget: OrderProductionTabWidget,
}

export default widget
