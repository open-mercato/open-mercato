import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * The QR panel belongs on the sales order detail, next to the totals it encodes.
 * `sales.document.detail.order:details` is the surface the sales module declares
 * for exactly this (see `sales/extension-points.ts`), so the placement is a
 * declaration here rather than a change in the sales module.
 */
export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.order:details': {
    widgetId: 'saudi_localization.injection.zatca-qr',
    priority: 70,
  },
}

export default injectionTable
