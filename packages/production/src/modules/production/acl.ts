/**
 * Feature flags for the production module.
 *
 * Ids are immutable contract surfaces (spec § Access Control). The operator
 * surface deliberately has its own minimal pair so shared shop-floor devices
 * can run a role that exposes nothing beyond the work queue (spec decision e).
 */
export const features = [
  { id: 'production.technology.view', title: 'View technology (BOMs, routings, work centers)', module: 'production' },
  { id: 'production.technology.manage', title: 'Manage technology (BOMs, routings, work centers)', module: 'production' },
  { id: 'production.stock.view', title: 'View production stock', module: 'production' },
  { id: 'production.stock.manage', title: 'Manage production stock (receipts, issues, adjustments)', module: 'production' },
  { id: 'production.orders.view', title: 'View production orders', module: 'production' },
  { id: 'production.orders.manage', title: 'Manage production orders', module: 'production' },
  { id: 'production.reports.view', title: 'View production reports', module: 'production' },
  { id: 'production.reports.manage', title: 'Manage production reports', module: 'production' },
  { id: 'production.operator.view', title: 'View operator work queue', module: 'production' },
  { id: 'production.operator.report', title: 'Report operations from the shop floor', module: 'production' },
  { id: 'production.mrp.view', title: 'View MRP runs and suggestions', module: 'production' },
  { id: 'production.mrp.manage', title: 'Run MRP and manage suggestions', module: 'production' },
]

export default features
